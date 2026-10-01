import { Request, Response } from 'express';
import { parsePdfToMarkdown, parseDocxToMarkdown } from '../services/parser.service';
import { indexDocument, storeOriginal } from '../services/knowledge.service';
import { logAction } from '../services/user.service';
import { logger } from '../logger';

/**
 * Controller to upload, parse, and register lightweight documents
 * into the HackerHelp RAG index.
 */
export async function uploadDocument(req: Request, res: Response): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: 'No file uploaded.' });
      return;
    }

    // Authorization is enforced by requireAdminToken; the audit actor is the API credential.
    const actorId = 'admin-api';

    const originalName = file.originalname;
    const fileExtension = originalName.substring(originalName.lastIndexOf('.')).toLowerCase();
    
    let markdownContent = '';
    let uploadFilename = originalName;

    logger.info(`Processing uploaded file: ${originalName} (${file.size} bytes)`);

    // Parse different formats into markdown
    if (fileExtension === '.pdf') {
      markdownContent = await parsePdfToMarkdown(file.buffer, originalName);
      // Change extension for storage upload
      uploadFilename = originalName.replace(/\.[^/.]+$/, '') + '.md';
    } else if (fileExtension === '.docx') {
      markdownContent = await parseDocxToMarkdown(file.buffer, originalName);
      uploadFilename = originalName.replace(/\.[^/.]+$/, '') + '.md';
    } else if (fileExtension === '.md' || fileExtension === '.txt') {
      markdownContent = file.buffer.toString('utf-8');
      // Format simple TXT into basic markdown header
      if (fileExtension === '.txt') {
        markdownContent = `# Document: ${originalName}\n\n${markdownContent}`;
        uploadFilename = originalName.replace(/\.[^/.]+$/, '') + '.md';
      }
    } else {
      res.status(400).json({
        success: false,
        error: `Unsupported file type: ${fileExtension}. Supported types are .pdf, .docx, .txt, .md`
      });
      return;
    }

    // Same filename => same slug and storage path, so re-uploading replaces rather than duplicates.
    const safeName = uploadFilename.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
    const slug = `upload/${safeName.replace(/\.md$/, '')}`;
    const storagePath = `uploads/${safeName}`;

    const storageObjectId = await storeOriginal(storagePath, markdownContent, 'text/markdown');
    const sections = await indexDocument({
      slug,
      title: originalName.replace(/\.[^/.]+$/, ''),
      body: markdownContent,
      sourceUrl: null,
      origin: 'upload',
      verification: 'official',
      storageObjectId
    });

    await logAction(actorId, 'upload_document_rag', 'Document', slug, { originalName, storagePath, sections });

    res.status(200).json({
      success: true,
      message: 'Document successfully uploaded and indexed.',
      data: { originalName, slug, storagePath, sections }
    });
  } catch (error: any) {
    logger.error('Document upload and parse pipeline failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process and index the document.'
    });
  }
}

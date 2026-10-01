import { Request, Response } from 'express';
import { parsePdfToMarkdown, parseDocxToMarkdown } from '../services/parser.service';
import { uploadToDocMindStorage } from '../services/docmind.service';
import { logAction, hasRole } from '../services/user.service';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

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

    const { actorId } = req.body;
    if (!actorId) {
      res.status(400).json({ success: false, error: 'Actor Discord ID (actorId) is required for audit logs.' });
      return;
    }

    // Enforce Admin Permission Checks
    const isAdmin = await hasRole(actorId, ['super_admin', 'event_admin']);
    if (!isAdmin) {
      res.status(403).json({ success: false, error: 'Access Denied: Only administrators can upload and index documents.' });
      return;
    }

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

    // Upload and index document sections through OpenAI and Supabase
    const storagePath = await uploadToDocMindStorage(uploadFilename, markdownContent, 'text/markdown');

    await logAction(actorId, 'upload_document_rag', 'Document', storagePath, { originalName, storagePath });

    res.status(200).json({
      success: true,
      message: 'Document successfully uploaded and indexed.',
      data: {
        originalName,
        storagePath,
        contentType: 'text/markdown'
      }
    });
  } catch (error: any) {
    logger.error('Document upload and parse pipeline failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process and index the document.',
      details: error.message
    });
  }
}

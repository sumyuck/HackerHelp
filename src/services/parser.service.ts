import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { logger } from '../logger';

/**
 * Extracts raw text from a PDF buffer and returns a clean Markdown string.
 */
export async function parsePdfToMarkdown(pdfBuffer: Buffer, fileName: string): Promise<string> {
  try {
    logger.info(`Parsing PDF file: ${fileName}`);
    const data = await pdfParse(pdfBuffer);
    
    // Format text as markdown
    const mdContent = [
      `# Document Archive: ${fileName}`,
      `*Source: PDF File Upload*`,
      `*Total Pages: ${data.numpages}*`,
      `---`,
      data.text
    ].join('\n\n');

    return mdContent;
  } catch (error) {
    logger.error(`Failed to parse PDF file ${fileName}:`, error);
    throw error;
  }
}

/**
 * Extracts raw text from a DOCX buffer and returns a clean Markdown string.
 */
export async function parseDocxToMarkdown(docxBuffer: Buffer, fileName: string): Promise<string> {
  try {
    logger.info(`Parsing DOCX file: ${fileName}`);
    const result = await mammoth.extractRawText({ buffer: docxBuffer });
    
    const mdContent = [
      `# Document Archive: ${fileName}`,
      `*Source: Word Document Upload*`,
      `---`,
      result.value
    ].join('\n\n');

    return mdContent;
  } catch (error) {
    logger.error(`Failed to parse DOCX file ${fileName}:`, error);
    throw error;
  }
}

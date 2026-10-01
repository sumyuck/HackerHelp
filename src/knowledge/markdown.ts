/**
 * Pure Markdown helpers for the knowledge base: front-matter parsing and
 * heading-aware chunking. No I/O, so they are unit-tested directly.
 */

export type Verification = 'official' | 'derived' | 'community';
const VERIFICATIONS: readonly Verification[] = ['official', 'derived', 'community'];

export interface KnowledgeDocumentMeta {
  title: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  verification: Verification;
  lastReviewed: string | null;
}

export interface Chunk {
  /** Breadcrumb such as "FAQ > Is Orchestrate solo or team-based?" — shown in logs and tickets. */
  heading: string;
  /** Text that is embedded and shown to the model. Prefixed with the breadcrumb for context. */
  content: string;
  sectionIndex: number;
}

/** Bump when chunking output changes so ingestion re-embeds every document. */
export const CHUNKER_VERSION = 2;

export function parseFrontMatter(raw: string): { meta: KnowledgeDocumentMeta; body: string } {
  const text = raw.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) throw new Error('Missing front matter (expected a leading --- block).');

  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue;
    const separator = line.indexOf(':');
    if (separator === -1) throw new Error(`Invalid front matter line: "${line}"`);
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  if (!fields.title) throw new Error('Front matter must include a title.');
  const verification = (fields.verification || 'official') as Verification;
  if (!VERIFICATIONS.includes(verification)) {
    throw new Error(`verification must be one of ${VERIFICATIONS.join(', ')}; got "${fields.verification}".`);
  }
  if (fields.source_url && !/^https:\/\//.test(fields.source_url)) {
    throw new Error('source_url must be an https:// URL.');
  }

  return {
    meta: {
      title: fields.title,
      sourceUrl: fields.source_url || null,
      sourceTitle: fields.source_title || null,
      verification,
      lastReviewed: fields.last_reviewed || null
    },
    body: text.slice(match[0].length)
  };
}

/**
 * Splits Markdown into one chunk per heading section. Each chunk carries its
 * heading path (e.g. "FAQ > Can I use my own tools?") because a bare paragraph
 * like "Yes." is meaningless to an embedding model without its question.
 * Sections longer than maxChars are split on paragraph boundaries.
 */
export function chunkMarkdown(body: string, documentTitle: string, maxChars = 1500): Chunk[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const headingStack: { level: number; text: string }[] = [];
  const sections: { path: string; lines: string[] }[] = [];
  let current: { path: string; lines: string[] } = { path: '', lines: [] };
  let inCodeFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inCodeFence = !inCodeFence;
    const heading = inCodeFence ? null : /^(#{1,6})\s+(.*)$/.exec(line);
    if (!heading) {
      current.lines.push(line);
      continue;
    }
    sections.push(current);
    const level = heading[1].length;
    while (headingStack.length && headingStack[headingStack.length - 1].level >= level) headingStack.pop();
    headingStack.push({ level, text: heading[2].trim() });
    // The H1 usually repeats the document title; leave it out of the breadcrumb.
    const path = headingStack
      .filter(h => !(h.level === 1 && h.text === documentTitle))
      .map(h => h.text)
      .join(' > ');
    current = { path, lines: [] };
  }
  sections.push(current);

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const text = section.lines.join('\n').trim();
    if (!text) continue;
    const heading = section.path ? `${documentTitle} > ${section.path}` : documentTitle;
    for (const part of splitByParagraph(text, maxChars)) {
      chunks.push({ heading, content: `${heading}\n\n${part}`, sectionIndex: chunks.length });
    }
  }
  return chunks;
}

function splitByParagraph(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let buffer = '';
  const flush = () => { if (buffer) parts.push(buffer); buffer = ''; };
  for (const paragraph of text.split(/\n{2,}/)) {
    if (paragraph.length > maxChars) {
      // A single oversized paragraph is hard-wrapped rather than dropped.
      flush();
      for (let start = 0; start < paragraph.length; start += maxChars) {
        parts.push(paragraph.slice(start, start + maxChars));
      }
      continue;
    }
    if (buffer && buffer.length + paragraph.length + 2 > maxChars) flush();
    buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
  }
  flush();
  return parts;
}

import { createHash } from 'node:crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';
import { generateEmbedding, generateEmbeddings } from './embedding.service';
import { chunkMarkdown, CHUNKER_VERSION, Verification } from '../knowledge/markdown';
import { getOpenAIModel } from './openai.service';

export type DocumentOrigin = 'knowledge_base' | 'upload' | 'discord_channel' | 'ticket_resolution';

export interface RetrievedSection {
  id: string;
  documentId: string;
  content: string;
  heading: string | null;
  similarity: number;
  documentSlug: string | null;
  documentTitle: string;
  sourceUrl: string | null;
  origin: DocumentOrigin;
  verification: Verification;
}

export interface IndexDocumentInput {
  slug: string;
  title: string;
  body: string;
  sourceUrl: string | null;
  origin: DocumentOrigin;
  verification: Verification;
  storageObjectId?: string | null;
}

let supabaseClient: SupabaseClient | undefined;

/** Created on first use so importing this module never throws; startup config validation reports missing keys. */
export function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL?.trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !serviceKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in .env.');
    }
    supabaseClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  return supabaseClient;
}

/**
 * Hash of everything that determines a document's stored vectors. Changing the
 * text, metadata, chunker, or embedding model all force a re-embed; anything
 * else is a no-op, which makes re-running ingestion free.
 */
export function documentContentHash(input: IndexDocumentInput): string {
  return createHash('sha256')
    .update(JSON.stringify({
      body: input.body,
      title: input.title,
      sourceUrl: input.sourceUrl,
      verification: input.verification,
      chunker: CHUNKER_VERSION,
      model: getOpenAIModel('OPENAI_EMBEDDING_MODEL')
    }))
    .digest('hex');
}

/** Returns slug -> content hash for every indexed document of an origin. */
export async function listIndexedDocuments(origin: DocumentOrigin): Promise<Map<string, string | null>> {
  const { data, error } = await getSupabase()
    .from('documents')
    .select('slug, content_hash')
    .eq('origin', origin)
    .not('slug', 'is', null);
  if (error) throw error;
  return new Map((data || []).map(row => [row.slug as string, row.content_hash as string | null]));
}

/** Chunks, embeds, and atomically replaces a document. Returns the number of sections stored. */
export async function indexDocument(input: IndexDocumentInput, contentHash = documentContentHash(input)): Promise<number> {
  const chunks = chunkMarkdown(input.body, input.title);
  if (!chunks.length) throw new Error(`Document "${input.slug}" has no indexable content.`);

  const embeddings = await generateEmbeddings(chunks.map(chunk => chunk.content));
  const sections = chunks.map((chunk, index) => ({
    content: chunk.content,
    heading: chunk.heading,
    section_index: chunk.sectionIndex,
    embedding: embeddings[index]
  }));

  const { error } = await getSupabase().rpc('upsert_document', {
    p_slug: input.slug,
    p_title: input.title,
    p_source_url: input.sourceUrl,
    p_origin: input.origin,
    p_verification: input.verification,
    p_content_hash: contentHash,
    p_sections: sections,
    p_storage_object_id: input.storageObjectId ?? null
  });
  if (error) throw error;

  logger.info('Indexed document', { slug: input.slug, origin: input.origin, sections: sections.length });
  return sections.length;
}

export async function deleteDocuments(slugs: string[]): Promise<void> {
  if (!slugs.length) return;
  // Sections are removed by the ON DELETE CASCADE foreign key.
  const { error } = await getSupabase().from('documents').delete().in('slug', slugs);
  if (error) throw error;
}

/** Stores an uploaded original in the private Storage bucket and returns its object ID. */
export async function storeOriginal(path: string, content: Buffer | string, contentType: string): Promise<string> {
  const { data, error } = await getSupabase().storage
    .from('files')
    .upload(path, content, { contentType, upsert: true });
  if (error) throw error;
  if (!data?.id) throw new Error('Storage upload did not return an object ID.');
  return data.id;
}

/** Vector search over all indexed sections, most similar first. */
export async function searchKnowledge(query: string, options: { limit: number; minSimilarity: number }): Promise<RetrievedSection[]> {
  const embedding = await generateEmbedding(query);
  const { data, error } = await getSupabase().rpc('match_document_sections', {
    query_embedding: embedding,
    match_threshold: options.minSimilarity,
    match_count: options.limit
  });
  if (error) throw error;

  return (data || [])
    .filter((row: any) => typeof row.content === 'string' && row.content.trim())
    .map((row: any): RetrievedSection => ({
      id: row.id,
      documentId: row.document_id,
      content: row.content,
      heading: row.heading ?? null,
      similarity: Number(row.similarity),
      documentSlug: row.document_slug ?? null,
      documentTitle: row.document_title,
      sourceUrl: row.source_url ?? null,
      origin: row.origin,
      verification: row.verification
    }));
}

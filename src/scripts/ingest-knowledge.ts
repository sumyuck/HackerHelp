import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger';
import { parseFrontMatter } from '../knowledge/markdown';
import {
  deleteDocuments,
  documentContentHash,
  indexDocument,
  IndexDocumentInput,
  listIndexedDocuments
} from '../services/knowledge.service';

/**
 * Syncs knowledge/ into Supabase.
 *   npm run kb:ingest                 index new and changed documents
 *   npm run kb:ingest -- --prune      also delete indexed docs whose files were removed
 *   npm run kb:ingest -- --dry-run    report what would change, call nothing
 * Idempotent: unchanged files (same content hash) are skipped without any API call.
 */

const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || path.resolve(__dirname, '../../knowledge');

export function loadKnowledgeFiles(root = KNOWLEDGE_DIR): IndexDocumentInput[] {
  if (!fs.existsSync(root)) throw new Error(`Knowledge directory not found: ${root}`);
  return (fs.readdirSync(root, { recursive: true }) as string[])
    .map(file => file.split(path.sep).join('/'))
    // Top-level files (README.md) document the folder itself and are not knowledge.
    .filter(file => file.endsWith('.md') && file.includes('/'))
    .sort()
    .map(file => {
      try {
        const { meta, body } = parseFrontMatter(fs.readFileSync(path.join(root, file), 'utf8'));
        return {
          slug: file.replace(/\.md$/, ''),
          title: meta.title,
          body,
          sourceUrl: meta.sourceUrl,
          origin: 'knowledge_base' as const,
          verification: meta.verification
        };
      } catch (error: any) {
        throw new Error(`${file}: ${error.message}`);
      }
    });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const prune = args.has('--prune');
  const dryRun = args.has('--dry-run');

  const documents = loadKnowledgeFiles();
  const indexed = await listIndexedDocuments('knowledge_base');
  const summary = { indexed: 0, unchanged: 0, pruned: 0, sections: 0 };

  for (const document of documents) {
    const hash = documentContentHash(document);
    if (indexed.get(document.slug) === hash) {
      summary.unchanged++;
      continue;
    }
    logger.info(`${dryRun ? '[dry-run] would index' : 'Indexing'} ${document.slug}`);
    if (!dryRun) summary.sections += await indexDocument(document, hash);
    summary.indexed++;
  }

  const present = new Set(documents.map(document => document.slug));
  const stale = [...indexed.keys()].filter(slug => !present.has(slug));
  if (stale.length && prune) {
    logger.info(`${dryRun ? '[dry-run] would prune' : 'Pruning'} ${stale.join(', ')}`);
    if (!dryRun) await deleteDocuments(stale);
    summary.pruned = stale.length;
  } else if (stale.length) {
    logger.warn(`Indexed documents with no source file (re-run with --prune to delete): ${stale.join(', ')}`);
  }

  logger.info('Knowledge base sync complete', { ...summary, dryRun, total: documents.length });
}

if (require.main === module) {
  main().catch(error => {
    logger.error('Knowledge base sync failed', { detail: error.message });
    process.exitCode = 1;
  });
}

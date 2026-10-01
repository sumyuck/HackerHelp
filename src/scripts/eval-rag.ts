import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { answerQuestion, AnswerResult } from '../services/answer.service';
import { searchKnowledge } from '../services/knowledge.service';
import { getChatModel } from '../services/llm.service';

/**
 * Runs the labelled cases in eval/rag-cases.json through the real pipeline
 * (live OpenAI + Supabase) and reports outcome accuracy, retrieval recall,
 * citation precision, and the similarity distributions used to pick thresholds.
 *   npm run eval:rag
 *   npm run eval:rag -- --only gate-   (run cases whose id starts with a prefix)
 *   npm run eval:rag -- --retrieval-only   (embeddings + vector search only; no chat calls)
 */

interface EvalCase {
  id: string;
  question: string;
  expect: AnswerResult['outcome'][];
  sources?: string[];
  mustNotContain?: string[];
}

interface CaseResult {
  id: string;
  question: string;
  expected: string[];
  outcome: string;
  pass: boolean;
  preferred: boolean;
  reason: string;
  topSimilarity: number | null;
  /** Best similarity among retrieved sections from an expected source: the evidence an answer would cite. */
  expectedSourceSimilarity: number | null;
  retrievedSlugs: (string | null)[];
  citedSlugs: (string | null)[];
  sourceRetrieved: boolean | null;
  citationCorrect: boolean | null;
  violations: string[];
  message: string;
}

const EVAL_DIR = path.resolve(__dirname, '../../eval');
const CONCURRENCY = 3;

/** Measures retrieval alone: what the model would have been shown, without paying for the model call. */
async function retrieveOnly(question: string): Promise<AnswerResult> {
  const retrieved = await searchKnowledge(question, {
    limit: Number(process.env.RAG_TOP_K ?? 6),
    minSimilarity: Number(process.env.RAG_RETRIEVAL_FLOOR ?? 0.25)
  });
  return { outcome: 'error', message: '', citations: [], confidence: null, reason: 'retrieval_only', category: null, priority: null, retrieved };
}

let retrievalOnly = false;

async function runCase(testCase: EvalCase): Promise<CaseResult> {
  const result = retrievalOnly ? await retrieveOnly(testCase.question) : await answerQuestion(testCase.question);
  const retrievedSlugs = result.retrieved.map(section => section.documentSlug);
  const citedSlugs = result.citations.map(citation => citation.slug);
  const sources = testCase.sources ?? [];
  const violations = (testCase.mustNotContain ?? []).filter(text => result.message.includes(text));

  return {
    id: testCase.id,
    question: testCase.question,
    expected: testCase.expect,
    outcome: result.outcome,
    pass: testCase.expect.includes(result.outcome) && violations.length === 0,
    preferred: testCase.expect[0] === result.outcome,
    reason: result.reason,
    topSimilarity: result.retrieved[0]?.similarity ?? null,
    expectedSourceSimilarity: sources.length
      ? Math.max(0, ...result.retrieved.filter(s => !!s.documentSlug && sources.includes(s.documentSlug)).map(s => s.similarity)) || null
      : null,
    retrievedSlugs,
    citedSlugs,
    sourceRetrieved: sources.length ? retrievedSlugs.some(slug => !!slug && sources.includes(slug)) : null,
    citationCorrect: sources.length && result.outcome === 'answered'
      ? citedSlugs.some(slug => !!slug && sources.includes(slug))
      : null,
    violations,
    message: result.message
  };
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

const pct = (part: number, whole: number) => (whole ? `${((100 * part) / whole).toFixed(0)}%` : 'n/a');
const fmt = (value: number | null) => (value === null ? '   -  ' : value.toFixed(3));

function stats(values: number[]) {
  if (!values.length) return 'n/a';
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return `min ${sorted[0].toFixed(3)} · p25 ${at(0.25).toFixed(3)} · median ${at(0.5).toFixed(3)} · max ${sorted[sorted.length - 1].toFixed(3)} (n=${sorted.length})`;
}

async function main() {
  retrievalOnly = process.argv.includes('--retrieval-only');
  const onlyIndex = process.argv.indexOf('--only');
  const prefix = onlyIndex > -1 ? process.argv[onlyIndex + 1] : '';
  const { cases } = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'rag-cases.json'), 'utf8')) as { cases: EvalCase[] };
  const selected = cases.filter(testCase => testCase.id.startsWith(prefix));

  const startedAt = Date.now();
  const results = await mapLimited(selected, CONCURRENCY, runCase);

  console.log('\nid                      expected              got           top_sim  cited');
  for (const r of results) {
    const mark = retrievalOnly ? '     ' : r.pass ? (r.preferred ? 'PASS ' : 'pass ') : 'FAIL ';
    console.log(`${mark}${r.id.padEnd(22)} ${r.expected.join('|').padEnd(21)} ${r.outcome.padEnd(13)} ${fmt(r.topSimilarity)}  ${r.citedSlugs.join(', ')}`);
    if (!r.pass && !retrievalOnly) console.log(`      reason: ${r.reason}${r.violations.length ? ` · contains forbidden: ${r.violations.join(', ')}` : ''}`);
  }

  const withSources = results.filter(r => r.sourceRetrieved !== null);
  const withCitations = results.filter(r => r.citationCorrect !== null);
  const inScope = results.filter(r => r.expected[0] === 'answered' && r.topSimilarity !== null).map(r => r.topSimilarity!);
  const evidence = results.filter(r => r.expectedSourceSimilarity !== null).map(r => r.expectedSourceSimilarity!);
  const outOfScope = results.filter(r => r.expected[0] === 'out_of_scope' && r.topSimilarity !== null).map(r => r.topSimilarity!);

  const summary = {
    model: getChatModel(),
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL,
    thresholds: {
      retrievalFloor: process.env.RAG_RETRIEVAL_FLOOR ?? '0.25 (default)',
      answerMinSimilarity: process.env.RAG_ANSWER_MIN_SIMILARITY ?? '0.3 (default)'
    },
    cases: results.length,
    passed: results.filter(r => r.pass).length,
    preferred: results.filter(r => r.preferred).length,
    sourceRecall: `${withSources.filter(r => r.sourceRetrieved).length}/${withSources.length}`,
    citationPrecision: `${withCitations.filter(r => r.citationCorrect).length}/${withCitations.length}`,
    inScopeTopSimilarity: stats(inScope),
    outOfScopeTopSimilarity: stats(outOfScope),
    expectedSourceSimilarity: stats(evidence),
    durationSeconds: Math.round((Date.now() - startedAt) / 1000)
  };

  console.log(`\nOutcome accuracy: ${summary.passed}/${summary.cases} (${pct(summary.passed, summary.cases)}); preferred outcome ${summary.preferred}/${summary.cases}`);
  console.log(`Expected source in top-k: ${summary.sourceRecall} · Answers citing an expected source: ${summary.citationPrecision}`);
  console.log(`Top similarity, in-scope questions:     ${summary.inScopeTopSimilarity}`);
  console.log(`Top similarity, out-of-scope questions: ${summary.outOfScopeTopSimilarity}`);
  console.log(`Best expected-source similarity:        ${summary.expectedSourceSimilarity}`);

  const resultsDir = path.join(EVAL_DIR, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const file = path.join(resultsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ summary, results }, null, 2));
  console.log(`\nFull results: ${path.relative(process.cwd(), file)}`);

  if (retrievalOnly) console.log('(retrieval-only run: outcome accuracy is not measured)');
  else if (summary.passed < summary.cases) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

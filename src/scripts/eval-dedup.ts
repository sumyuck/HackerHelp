import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { generateEmbeddings } from '../services/embedding.service';
import { classifyTicket } from '../services/ticket-classifier.service';

/**
 * Calibrates TICKET_DUPLICATE_SIMILARITY: embeds labelled ticket pairs and
 * reports precision/recall at each threshold.
 *   npm run eval:dedup                 embed raw ticket text
 *   npm run eval:dedup -- --canonical  embed the classifier's canonical issue (what production uses)
 */

const cosine = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return dot / Math.sqrt(na * nb);
};

async function main() {
  const file = path.resolve(__dirname, '../../eval/dedup-pairs.json');
  const { same, different } = JSON.parse(fs.readFileSync(file, 'utf8')) as { same: [string, string][]; different: [string, string][] };
  const texts = [...new Set([...same, ...different].flat())];
  const canonical = process.argv.includes('--canonical');
  const embedded = new Map(texts.map(t => [t, t]));
  if (canonical) {
    for (const text of texts) {
      const { canonicalIssue, category } = await classifyTicket(text, { category: null, priority: null });
      embedded.set(text, canonicalIssue);
      console.log(`  [${category}] ${canonicalIssue}  <=  ${text}`);
    }
  }
  const inputs = texts.map(t => embedded.get(t)!);
  const vectors = new Map((await generateEmbeddings(inputs)).map((v, i) => [texts[i], v]));
  const score = ([a, b]: [string, string]) => cosine(vectors.get(a)!, vectors.get(b)!);

  const sameScores = same.map(pair => ({ pair, s: score(pair) })).sort((x, y) => x.s - y.s);
  const diffScores = different.map(pair => ({ pair, s: score(pair) })).sort((x, y) => y.s - x.s);

  console.log('\nLowest-scoring true duplicates:');
  for (const { pair, s } of sameScores.slice(0, 4)) console.log(`  ${s.toFixed(3)}  "${pair[0]}" ~ "${pair[1]}"`);
  console.log('Highest-scoring non-duplicates:');
  for (const { pair, s } of diffScores.slice(0, 4)) console.log(`  ${s.toFixed(3)}  "${pair[0]}" ~ "${pair[1]}"`);

  console.log('\nthreshold  dup_found  false_dup  precision');
  for (let t = 0.5; t <= 0.951; t += 0.05) {
    const tp = sameScores.filter(x => x.s >= t).length;
    const fp = diffScores.filter(x => x.s >= t).length;
    const precision = tp + fp ? tp / (tp + fp) : 1;
    console.log(`  ${t.toFixed(2)}      ${String(tp).padStart(2)}/${same.length}      ${String(fp).padStart(2)}/${different.length}      ${precision.toFixed(2)}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

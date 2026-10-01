import { getOpenAIClient, getOpenAIModel } from './openai.service';
import { withRetry } from './retry';

/** OpenAI accepts up to 2048 inputs per request; stay well below to bound request size. */
const MAX_BATCH = 96;

/** Generate a vector for ingestion and retrieval using the same OpenAI model. */
export async function generateEmbedding(text: string): Promise<number[]> {
  const [embedding] = await generateEmbeddings([text]);
  return embedding;
}

/** Embeds many texts in as few requests as possible, preserving input order. */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.some(text => !text.trim())) {
    throw new Error('Cannot generate an embedding for empty text.');
  }

  const results: number[][] = [];
  for (let start = 0; start < texts.length; start += MAX_BATCH) {
    const batch = texts.slice(start, start + MAX_BATCH);
    const response = await withRetry('openai.embeddings', () => getOpenAIClient().embeddings.create({
      model: getOpenAIModel('OPENAI_EMBEDDING_MODEL'),
      input: batch,
      encoding_format: 'float'
    }));
    // The API returns an index per item; sort rather than trusting response order.
    const ordered = [...response.data].sort((a, b) => a.index - b.index);
    if (ordered.length !== batch.length) throw new Error('OpenAI returned an invalid embedding.');
    for (const item of ordered) {
      if (!item.embedding?.length || !item.embedding.every(Number.isFinite)) {
        throw new Error('OpenAI returned an invalid embedding.');
      }
      results.push(item.embedding);
    }
  }
  return results;
}

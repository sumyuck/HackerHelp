import { getOpenAIClient, getOpenAIModel } from './openai.service';

/** Generate a vector for ingestion and retrieval using the same OpenAI model. */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text.trim()) {
    throw new Error('Cannot generate an embedding for empty text.');
  }

  const response = await getOpenAIClient().embeddings.create({
    model: getOpenAIModel('OPENAI_EMBEDDING_MODEL'),
    input: text,
    encoding_format: 'float'
  });

  const embedding = response.data[0]?.embedding;
  if (!embedding?.length || !embedding.every(Number.isFinite)) {
    throw new Error('OpenAI returned an invalid embedding.');
  }
  return embedding;
}

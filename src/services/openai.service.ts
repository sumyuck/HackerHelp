import OpenAI from 'openai';

/** OpenAI is used for embeddings only; chat generation runs on Anthropic (llm.service.ts). */

let client: OpenAI | undefined;

export function getOpenAIModel(variable: 'OPENAI_EMBEDDING_MODEL'): string {
  const model = process.env[variable]?.trim();
  if (!model) throw new Error(`${variable} must be configured in .env.`);
  return model;
}

export function getOpenAIClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error('OPENAI_API_KEY must be configured in .env.');
    // SDK retries are off: its backoff honours Retry-After uncapped (a quota 429 asks for ~30 min).
    // Every call goes through withRetry instead, which bounds total wait time. See retry.ts.
    client = new OpenAI({ apiKey, timeout: 20_000, maxRetries: 0 });
  }
  return client;
}

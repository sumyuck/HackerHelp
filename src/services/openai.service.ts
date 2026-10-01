import OpenAI from 'openai';

let client: OpenAI | undefined;

export function getOpenAIModel(variable: 'OPENAI_CHAT_MODEL' | 'OPENAI_EMBEDDING_MODEL'): string {
  const model = process.env[variable]?.trim();
  if (!model) throw new Error(`${variable} must be configured in .env.`);
  return model;
}

export function getOpenAIClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error('OPENAI_API_KEY must be configured in .env.');
    client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 2 });
  }
  return client;
}

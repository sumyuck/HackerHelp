import OpenAI from 'openai';
import { withRetry } from './retry';

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
    // SDK retries are off: its backoff honours Retry-After uncapped (a quota 429 asks for ~30 min).
    // Every call goes through withRetry instead, which bounds total wait time. See retry.ts.
    client = new OpenAI({ apiKey, timeout: 20_000, maxRetries: 0 });
  }
  return client;
}

/** Free-form generation for drafting tasks (e.g. announcements). Not grounded; never use for factual answers. */
export async function composeText(systemPrompt: string, userPrompt: string, maxTokens = 1024): Promise<string> {
  const response = await withRetry('openai.chat', () => getOpenAIClient().chat.completions.create({
    model: getOpenAIModel('OPENAI_CHAT_MODEL'),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_completion_tokens: maxTokens
  }));
  const text = response.choices[0]?.message?.content?.trim();
  if (!text) throw new Error('OpenAI returned an empty chat response.');
  return text;
}

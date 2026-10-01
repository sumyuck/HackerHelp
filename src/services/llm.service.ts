import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { withRetry } from './retry';

/**
 * Chat generation via the Anthropic Messages API. Embeddings stay on OpenAI
 * (embedding.service.ts); only generation runs here.
 *
 * On models that support it, requests opt into server-side refusal fallback:
 * if the model's safety classifier declines, Anthropic re-runs the request on
 * its recommended fallback model. If the request is still refused, we raise
 * LlmRefusalError so callers can hand off to a human.
 */

// Haiku: the cheapest current model. Triage and drafting are short, well-specified tasks.
export const DEFAULT_CHAT_MODEL = 'claude-haiku-4-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let client: Anthropic | undefined;

export function getChatModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_CHAT_MODEL;
}

export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY must be configured in .env.');
    // SDK retries are off; withRetry bounds total wait time (see retry.ts).
    client = new Anthropic({ apiKey, maxRetries: 0, timeout: 60_000 });
  }
  return client;
}

export class LlmRefusalError extends Error {
  constructor(readonly category: string | null) {
    super(`Model declined the request${category ? ` (${category})` : ''}.`);
    this.name = 'LlmRefusalError';
  }
}

type Effort = 'low' | 'medium' | 'high';

/**
 * Model-dependent request options. Haiku 4.5 rejects `effort` and is not a
 * server-side-fallback model, so it gets neither; newer models get both.
 */
export function modelOptions(model: string, effort: Effort) {
  if (/^claude-haiku/i.test(model)) return { output_config: {} };
  return { betas: [FALLBACK_BETA], fallbacks: 'default' as const, output_config: { effort } };
}

function ensureCompleted(response: { stop_reason: string | null; stop_details?: { category?: string | null } | null }) {
  if (response.stop_reason === 'refusal') throw new LlmRefusalError(response.stop_details?.category ?? null);
  if (response.stop_reason === 'max_tokens') throw new Error('Model response was truncated (max_tokens).');
}

/**
 * One request whose response must match a JSON schema; returns the parsed JSON.
 * Typed as unknown on purpose: callers validate the shape themselves (the SDK's
 * schema-to-type inference is too deep for TypeScript on non-trivial schemas).
 */
export async function generateStructured(params: {
  system: string;
  user: string;
  schema: { type: 'object' } & Record<string, unknown>;
  effort?: Effort;
}): Promise<unknown> {
  const model = getChatModel();
  const options = modelOptions(model, params.effort ?? 'low');
  const response = await withRetry('anthropic.messages', () => getAnthropicClient().beta.messages.parse({
    model,
    ...options,
    max_tokens: 16000,
    system: params.system,
    messages: [{ role: 'user', content: params.user }],
    output_config: { ...options.output_config, format: jsonSchemaOutputFormat(params.schema as { type: 'object' }) }
  }));
  ensureCompleted(response);
  if (response.parsed_output === null) throw new Error('Model returned output that does not match the schema.');
  return response.parsed_output;
}

/** Free-form generation for drafting tasks (announcements, summaries). Not grounded; never use for factual answers. */
export async function generateText(system: string, user: string, effort: Effort = 'medium'): Promise<string> {
  const model = getChatModel();
  const response = await withRetry('anthropic.messages', () => getAnthropicClient().beta.messages.create({
    model,
    ...modelOptions(model, effort),
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: user }]
  }));
  ensureCompleted(response);
  const text = response.content
    .flatMap(block => (block.type === 'text' ? [block.text] : []))
    .join('')
    .trim();
  if (!text) throw new Error('Model returned an empty response.');
  return text;
}

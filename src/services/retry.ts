import { logger } from '../logger';

/**
 * Bounded retry for upstream API calls (OpenAI).
 *
 * The OpenAI SDK's built-in retry sleeps for whatever Retry-After the server
 * sends, uncapped. A daily-quota 429 asks for ~30 minutes, which would leave a
 * Discord interaction hanging until its 15-minute token expires. So the SDK's
 * retries are disabled and this policy is used instead:
 *   - retry only transient failures (429, 408, 409, 5xx, network/timeouts)
 *   - exponential backoff with full jitter, capped per attempt
 *   - fail fast when the server asks to wait longer than the cap, or when a
 *     429 means quota exhaustion (retrying cannot succeed)
 * Callers get an UpstreamUnavailableError carrying retryAfterMs so a queue
 * can reschedule the work instead of blocking on it.
 */

export class UpstreamUnavailableError extends Error {
  constructor(
    message: string,
    readonly operation: string,
    readonly status: number | null,
    readonly retryAfterMs: number | null,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'UpstreamUnavailableError';
  }
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function statusOf(error: any): number | null {
  return typeof error?.status === 'number' ? error.status : null;
}

/** Parses Retry-After / retry-after-ms from an SDK error's response headers. */
export function retryAfterMs(error: any): number | null {
  const headers = error?.headers;
  const get = (name: string): string | null =>
    typeof headers?.get === 'function' ? headers.get(name) : headers?.[name] ?? null;

  const ms = parseFloat(get('retry-after-ms') ?? '');
  if (Number.isFinite(ms) && ms >= 0) return ms;
  const header = get('retry-after');
  if (!header) return null;
  const seconds = parseFloat(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function isQuotaExhausted(error: any): boolean {
  const code = error?.code ?? error?.error?.code;
  return code === 'insufficient_quota' || /requests per day|insufficient_quota|exceeded your current quota/i.test(String(error?.message ?? ''));
}

function isTransient(error: any): boolean {
  const status = statusOf(error);
  if (status === null) {
    // No HTTP status: connection reset, DNS failure, or client-side timeout.
    return /connection|timeout|timed out|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(`${error?.name} ${error?.message}`);
  }
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export async function withRetry<T>(operation: string, fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8_000;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = statusOf(error);
      if (!isTransient(error)) throw error;

      const requested = retryAfterMs(error);
      const unavailable = (why: string) =>
        new UpstreamUnavailableError(`${operation} unavailable: ${why}`, operation, status, requested, error);

      if (status === 429 && isQuotaExhausted(error)) throw unavailable('quota exhausted');
      if (requested !== null && requested > maxDelayMs) throw unavailable(`server asked to retry after ${Math.round(requested / 1000)}s`);
      if (attempt >= maxAttempts) throw unavailable(`failed after ${attempt} attempts`);

      // Full jitter spreads retries from concurrent callers instead of synchronising them.
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = requested ?? Math.round(Math.random() * backoff);
      logger.warn('Retrying upstream call', { operation, attempt, status, delayMs: delay });
      await sleep(delay);
    }
  }
}

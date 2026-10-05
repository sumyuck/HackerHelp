import { isTransient, UpstreamUnavailableError } from '../services/retry';

/**
 * Queue-level retry policy for support jobs. Pure, so it is unit-tested.
 *
 * Two layers of retry, by design:
 *  - retry.ts retries a single upstream call a few times within seconds (blips).
 *  - this policy reschedules the whole job for longer outages, honouring the
 *    provider's Retry-After, but only while a retry can still reach the user:
 *    a Discord interaction token expires 15 minutes after the command, so every
 *    job carries a deadline and a retry that cannot finish before it is not attempted.
 * When no retry is possible the job degrades (e.g. the "busy" answer with an
 * "Open a ticket" button) instead of failing silently.
 */

export interface QueueRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const SUPPORT_RETRY_POLICY: QueueRetryPolicy = { maxAttempts: 4, baseDelayMs: 5_000, maxDelayMs: 60_000 };

/** Interaction tokens last 15 minutes; leave a minute to process and deliver. */
export const DELIVERY_DEADLINE_MS = 14 * 60_000;

export function isRetryable(error: unknown): boolean {
  // An exhausted quota does not come back within the deadline.
  if (error instanceof UpstreamUnavailableError) return error.kind !== 'quota_exhausted';
  return isTransient(error);
}

const requestedDelay = (error: unknown) => (error instanceof UpstreamUnavailableError ? error.retryAfterMs : null);

/** Longest the next retry may wait, or null if the provider asked for longer than the policy allows. */
export function maxRetryDelay(attempt: number, error: unknown, policy = SUPPORT_RETRY_POLICY): number | null {
  const requested = requestedDelay(error);
  if (requested !== null) return requested <= policy.maxDelayMs ? requested : null;
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
}

/** Delay before the next attempt: Retry-After when given, else exponential backoff with jitter in [cap/2, cap]. */
export function retryDelay(attempt: number, error: unknown, policy = SUPPORT_RETRY_POLICY, random = Math.random): number {
  const cap = maxRetryDelay(attempt, error, policy) ?? policy.maxDelayMs;
  if (requestedDelay(error) !== null) return cap;
  return Math.round(cap / 2 + (random() * cap) / 2);
}

export type RetryDecision = { retry: true; delayMs: number } | { retry: false; why: string };

/** `attempt` is the 1-based number of the attempt that just failed. */
export function decideRetry(
  input: { attempt: number; error: unknown; deadlineAt: number; now: number },
  policy = SUPPORT_RETRY_POLICY,
  random = Math.random
): RetryDecision {
  if (!isRetryable(input.error)) return { retry: false, why: 'not_retryable' };
  if (input.attempt >= policy.maxAttempts) return { retry: false, why: 'attempts_exhausted' };
  const longest = maxRetryDelay(input.attempt, input.error, policy);
  if (longest === null) return { retry: false, why: 'retry_after_too_long' };
  if (input.now + longest > input.deadlineAt) return { retry: false, why: 'deadline' };
  return { retry: true, delayMs: retryDelay(input.attempt, input.error, policy, random) };
}

/** Thrown by the worker to ask BullMQ for a retry after a specific delay. */
export class RetryLater extends Error {
  constructor(readonly delayMs: number, readonly cause: unknown) {
    super(`Retrying in ${delayMs}ms: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = 'RetryLater';
  }
}

/**
 * What a job processor sees. `willRetry` tells it whether a failure would be
 * retried, so it can degrade gracefully on the last chance instead of throwing.
 * `checkpoint` persists progress, so a retry skips completed side effects.
 */
export interface JobContext<S extends object> {
  readonly attempt: number;
  readonly state: Partial<S>;
  willRetry(error: unknown): boolean;
  checkpoint(patch: Partial<S>): Promise<void>;
}

import IORedis from 'ioredis';
import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import { logger } from '../logger';
import { decideRetry, JobContext, RetryLater, retryDelay, SUPPORT_RETRY_POLICY } from './retry-policy';

/**
 * Support work (model calls, ticket creation) runs as BullMQ jobs so the
 * Discord gateway handler only acknowledges and enqueues.
 *
 *  - Idempotency: the job ID is derived from the Discord interaction or message ID,
 *    so a redelivered event or double submit enqueues nothing new. Completed jobs
 *    are kept for a day to keep that guarantee.
 *  - Retries: see retry-policy.ts. Processors checkpoint progress into the job,
 *    so a retry never repeats a model call or a reply that already happened.
 *  - Dead letters: a job that fails for good notifies the user (best effort) and
 *    is copied, without its interaction token, to the `support-dead-letter` queue.
 *  - Without REDIS_URL, or if Redis cannot accept the job, the same processor runs
 *    inline: no queued retries, but the bot keeps answering.
 */

export interface SupportJobBase {
  kind: string;
  /** Discord interaction or message ID: the idempotency key. */
  sourceId: string;
  /** Epoch ms after which the reply can no longer be delivered. */
  deadlineAt: number;
  state?: object;
}

type StateOf<J extends SupportJobBase> = NonNullable<J['state']>;

export interface SupportJobHandlers<J extends SupportJobBase> {
  process(job: J, ctx: JobContext<StateOf<J>>): Promise<void>;
  /** Tells the user the request failed. Called once, after the last attempt. */
  onFinalFailure(job: J, error: unknown): Promise<void>;
}

const QUEUE_NAME = 'support';
const DEAD_LETTER_NAME = 'support-dead-letter';
const ENQUEUE_TIMEOUT_MS = 3_000;

let handlers: SupportJobHandlers<any> | null = null;
let queue: Queue | null = null;
let deadLetter: Queue | null = null;
let worker: Worker | null = null;
let connections: IORedis[] = [];

export const jobIdFor = (job: SupportJobBase) => `${job.kind}-${job.sourceId}`;

function describe(error: unknown): string {
  const e = error as { name?: string; message?: string };
  return `${e?.name ?? 'Error'}: ${e?.message ?? String(error)}`.slice(0, 500);
}

/** Dead letters are kept for inspection; the interaction token is a credential and is dropped. */
function redact(job: SupportJobBase): object {
  const copy: any = { ...job, state: undefined };
  if (copy.target?.token) copy.target = { ...copy.target, token: '[redacted]' };
  return copy;
}

async function runJob(job: Job<SupportJobBase>): Promise<void> {
  const attempt = job.attemptsMade + 1;
  const state: Record<string, unknown> = { ...(job.data.state ?? {}) };
  const decide = (error: unknown) => decideRetry({ attempt, error, deadlineAt: job.data.deadlineAt, now: Date.now() });
  const ctx: JobContext<any> = {
    attempt,
    state,
    willRetry: error => decide(error).retry,
    async checkpoint(patch) {
      Object.assign(state, patch);
      await job.updateData({ ...job.data, state });
    }
  };

  try {
    await handlers!.process(job.data, ctx);
  } catch (error) {
    const decision = decide(error);
    if (decision.retry) {
      logger.warn('Support job failed; retrying', { jobId: job.id, attempt, delayMs: decision.delayMs, error: describe(error) });
      throw new RetryLater(decision.delayMs, error);
    }
    logger.error('Support job failed permanently', { jobId: job.id, attempt, why: decision.why, error: describe(error) });
    await handlers!.onFinalFailure({ ...job.data, state }, error)
      .catch(notifyError => logger.error('Could not notify user of failed support job', { jobId: job.id, error: describe(notifyError) }));
    await deadLetter!.add(job.data.kind, { job: redact(job.data), error: describe(error), why: decision.why, attempts: attempt, failedAt: new Date().toISOString() }, { jobId: job.id })
      .catch(dlqError => logger.error('Could not write dead letter', { jobId: job.id, error: describe(dlqError) }));
    throw new UnrecoverableError(describe(error));
  }
}

async function runInline<J extends SupportJobBase>(job: J): Promise<void> {
  const state: Record<string, unknown> = { ...(job.state ?? {}) };
  const ctx: JobContext<any> = {
    attempt: 1,
    state,
    willRetry: () => false,
    async checkpoint(patch) { Object.assign(state, patch); }
  };
  try {
    await handlers!.process(job, ctx);
  } catch (error) {
    logger.error('Support job failed (inline)', { jobId: jobIdFor(job), error: describe(error) });
    await handlers!.onFinalFailure({ ...job, state }, error)
      .catch(notifyError => logger.error('Could not notify user of failed support job', { jobId: jobIdFor(job), error: describe(notifyError) }));
  }
}

export function startSupportQueue<J extends SupportJobBase>(
  jobHandlers: SupportJobHandlers<J>,
  options: { redisUrl?: string; concurrency?: number } = {}
): void {
  handlers = jobHandlers;
  if (!options.redisUrl) {
    logger.warn('REDIS_URL is not set: support jobs run inline (no queued retries or dead-letter queue).');
    return;
  }

  const onRedisError = (role: string) => (error: Error) => logger.warn('Redis connection error', { role, detail: error.message });
  // Producer: fail fast so a Redis outage falls back to inline processing instead of hanging the handler.
  const producer = new IORedis(options.redisUrl, { maxRetriesPerRequest: 1 }).on('error', onRedisError('producer'));
  // Worker: BullMQ requires blocking connections to retry forever.
  const consumer = new IORedis(options.redisUrl, { maxRetriesPerRequest: null }).on('error', onRedisError('worker'));
  connections = [producer, consumer];

  queue = new Queue(QUEUE_NAME, {
    connection: producer,
    defaultJobOptions: {
      attempts: SUPPORT_RETRY_POLICY.maxAttempts,
      backoff: { type: 'support' },
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 }
    }
  });
  deadLetter = new Queue(DEAD_LETTER_NAME, { connection: producer });
  queue.on('error', onRedisError('queue'));
  deadLetter.on('error', onRedisError('dead-letter'));

  worker = new Worker(QUEUE_NAME, runJob, {
    connection: consumer,
    concurrency: options.concurrency ?? 4,
    settings: {
      backoffStrategy: (attemptsMade, _type, error) =>
        error instanceof RetryLater ? error.delayMs : retryDelay(attemptsMade, error)
    }
  });
  worker.on('error', onRedisError('worker'));
  logger.info('Support queue started', { concurrency: options.concurrency ?? 4 });
}

/**
 * Enqueues a job, or runs it inline when there is no queue. Adding a job whose ID
 * already exists is a no-op in BullMQ, which is what makes redelivery harmless.
 */
export async function dispatchSupportJob<J extends SupportJobBase>(job: J): Promise<void> {
  if (!handlers) throw new Error('Support queue has not been started.');
  if (queue) {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        queue.add(job.kind, job, { jobId: jobIdFor(job) }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('enqueue timed out')), ENQUEUE_TIMEOUT_MS); })
      ]);
      return;
    } catch (error) {
      // If the add did land after all, worker and inline run both execute; processors are idempotent.
      logger.error('Could not enqueue support job; processing inline', { jobId: jobIdFor(job), error: describe(error) });
    } finally {
      clearTimeout(timer);
    }
  }
  await runInline(job);
}

export function supportQueueMode(): 'redis' | 'inline' {
  return queue ? 'redis' : 'inline';
}

export function redisConnected(): boolean | null {
  return connections.length ? connections.every(c => c.status === 'ready') : null;
}

export async function supportQueueStats() {
  if (!queue || !deadLetter) return { mode: 'inline' as const };
  const [counts, deadLetterCount, recent] = await Promise.all([
    queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
    deadLetter.getWaitingCount(),
    deadLetter.getWaiting(0, 9)
  ]);
  return {
    mode: 'redis' as const,
    counts,
    deadLetter: {
      count: deadLetterCount,
      // IDs, kinds and errors only: question text stays out of the admin API.
      recent: recent.map(j => ({ id: j.id, kind: j.name, error: j.data.error, why: j.data.why, attempts: j.data.attempts, failedAt: j.data.failedAt }))
    }
  };
}

/** Lets active jobs finish (bounded by the shutdown timeout), then closes connections. */
export async function stopSupportQueue(): Promise<void> {
  await worker?.close();
  await Promise.all([queue?.close(), deadLetter?.close()]);
  await Promise.all(connections.map(c => c.quit().catch(() => c.disconnect())));
  worker = queue = deadLetter = null;
  connections = [];
}

import assert from 'node:assert/strict';

// Fake configuration: modules below create API clients at import time. Nothing here calls the network.
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
process.env.OPENAI_EMBEDDING_MODEL = 'test-embedding-model';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-supabase-key';
process.env.LOG_LEVEL = 'error';

async function testRetryPolicy() {
  const { decideRetry, maxRetryDelay, retryDelay, SUPPORT_RETRY_POLICY: policy } = await import('../queue/retry-policy');
  const { UpstreamUnavailableError } = await import('../services/retry');
  const now = 1_000_000;
  const far = now + 60 * 60_000;
  const upstream = (kind: 'quota_exhausted' | 'retry_after_too_long' | 'attempts_exhausted', retryAfterMs: number | null = null) =>
    new UpstreamUnavailableError('down', 'anthropic.messages', 529, retryAfterMs, kind);

  // Exponential backoff: 5s, 10s, 20s caps, jittered into [cap/2, cap].
  assert.equal(maxRetryDelay(1, upstream('attempts_exhausted')), 5_000);
  assert.equal(maxRetryDelay(3, upstream('attempts_exhausted')), 20_000);
  assert.equal(retryDelay(2, upstream('attempts_exhausted'), policy, () => 0), 5_000);
  assert.equal(retryDelay(2, upstream('attempts_exhausted'), policy, () => 1), 10_000);

  // Retry-After is honoured exactly, unless it exceeds what the policy will wait.
  let d = decideRetry({ attempt: 1, error: upstream('retry_after_too_long', 30_000), deadlineAt: far, now });
  assert.deepEqual(d, { retry: true, delayMs: 30_000 });
  d = decideRetry({ attempt: 1, error: upstream('retry_after_too_long', 30 * 60_000), deadlineAt: far, now });
  assert.deepEqual(d, { retry: false, why: 'retry_after_too_long' });

  // Quota exhaustion and programming errors are never retried; network errors are.
  assert.deepEqual(decideRetry({ attempt: 1, error: upstream('quota_exhausted'), deadlineAt: far, now }), { retry: false, why: 'not_retryable' });
  assert.deepEqual(decideRetry({ attempt: 1, error: new TypeError('x is undefined'), deadlineAt: far, now }), { retry: false, why: 'not_retryable' });
  assert.equal(decideRetry({ attempt: 1, error: Object.assign(new Error('read ECONNRESET'), { name: 'MongoNetworkError' }), deadlineAt: far, now }).retry, true);
  assert.equal(decideRetry({ attempt: 1, error: Object.assign(new Error('Service Unavailable'), { status: 503 }), deadlineAt: far, now }).retry, true);
  // A Discord 404 (e.g. expired interaction) will not get better.
  assert.equal(decideRetry({ attempt: 1, error: Object.assign(new Error('Unknown interaction'), { status: 404 }), deadlineAt: far, now }).retry, false);

  // Bounded attempts, and no retry that would land after the interaction token expires.
  assert.deepEqual(decideRetry({ attempt: policy.maxAttempts, error: upstream('attempts_exhausted'), deadlineAt: far, now }), { retry: false, why: 'attempts_exhausted' });
  assert.deepEqual(decideRetry({ attempt: 1, error: upstream('attempts_exhausted'), deadlineAt: now + 4_000, now }), { retry: false, why: 'deadline' });
}

/** In-memory JobContext that persists state across "attempts" like BullMQ job data does. */
function fakeContext(stored: Record<string, unknown>, willRetry = false) {
  return {
    attempt: 1,
    state: { ...stored },
    willRetry: () => willRetry,
    async checkpoint(patch: Record<string, unknown>) { Object.assign(this.state, patch); Object.assign(stored, patch); }
  };
}

async function testProcessorIdempotency() {
  const { createSupportJobHandlers } = await import('../discord/support-jobs');
  const answer = { outcome: 'answered', message: 'Submissions close at 23:59 IST.', citations: [], confidence: 0.6, reason: 'ok', category: null, priority: null, retrieved: [] } as any;

  const calls = { answer: 0, followUp: 0, sends: [] as { nonce: string; content?: string }[], cleared: 0 };
  let failNextSend = false;
  let lastRethrowIf: ((e: unknown) => boolean) | undefined;
  const handlers = createSupportJobHandlers({
    answer: async (_q, options) => { calls.answer++; lastRethrowIf = options?.rethrowIf; return answer; },
    followUp: async () => { calls.followUp++; return []; },
    ticketOpenReply: async () => ({ content: 'ticket' }),
    ticketRequestReply: async () => ({ reply: { content: 'Opened ticket #7' }, ticketExists: true }),
    delivery: {
      async send(_target, payload, nonce) {
        if (failNextSend) { failNextSend = false; throw Object.assign(new Error('Discord 503'), { status: 503 }); }
        calls.sends.push({ nonce, content: payload.content });
      },
      async clearButtons() { calls.cleared++; throw new Error('message was ephemeral'); }
    }
  });

  const job = {
    kind: 'answer' as const, question: 'When do submissions close?', sourceId: '1300000000000000001', deadlineAt: Date.now() + 60_000,
    target: { type: 'message' as const, channelId: 'c', messageId: '1300000000000000001' },
    requester: { guildId: 'g', userId: 'u', userTag: 'user#0001' }
  };

  // Attempt 1: the model answers, then delivery fails. The answer is already checkpointed.
  const stored: Record<string, unknown> = {};
  failNextSend = true;
  await assert.rejects(handlers.process(job, fakeContext(stored, true) as any), /Discord 503/);
  assert.equal(calls.answer, 1);
  assert.ok(stored.answer, 'answer checkpointed before delivery');
  assert.equal(lastRethrowIf?.(new Error('x')), true, 'pipeline is told a retry is still possible');

  // Attempt 2: no second model call; the reply goes out once, with the message ID as nonce.
  await handlers.process(job, fakeContext(stored) as any);
  assert.equal(calls.answer, 1);
  assert.deepEqual(calls.sends.map(s => s.nonce), [job.sourceId]);
  assert.equal(stored.delivered, true);

  // A stalled-job re-run after delivery sends nothing new.
  await handlers.process(job, fakeContext(stored) as any);
  assert.equal(calls.sends.length, 1);
  // Follow-up recording is repeated but idempotent by design (dedupe keys, upserts).
  assert.equal(calls.followUp, 3);

  // Final failure: notify once with a generic message, never after a delivered reply.
  await handlers.onFinalFailure({ ...job, state: { delivered: true } }, new Error('boom'));
  assert.equal(calls.sends.length, 1);
  await handlers.onFinalFailure({ ...job, state: {} }, new Error('internal detail'));
  assert.equal(calls.sends.length, 2);
  assert.equal(calls.sends[1].nonce, `${job.sourceId}f`);
  assert.doesNotMatch(calls.sends[1].content!, /internal detail/, 'internal errors are not shown to users');

  // Ticket buttons are cleared once a ticket exists; failing to clear them is not a job failure.
  await handlers.process({
    ...job, kind: 'ticket_request', pendingId: 'p1', forceCreate: false, buttonMessage: { channelId: 'c', messageId: 'm' },
    target: { type: 'interaction', applicationId: 'a', token: 't' }
  }, fakeContext({}) as any);
  assert.equal(calls.cleared, 1);
  assert.equal(calls.sends.at(-1)!.content, 'Opened ticket #7');
}

async function testInlineDispatch() {
  const { startSupportQueue, dispatchSupportJob, supportQueueMode } = await import('../queue/support-queue');
  const seen: string[] = [];
  startSupportQueue({
    async process(job: any) { seen.push(`process:${job.sourceId}`); if (job.sourceId === 'bad') throw new Error('boom'); },
    async onFinalFailure(job: any) { seen.push(`failed:${job.sourceId}`); }
  });
  assert.equal(supportQueueMode(), 'inline');
  await dispatchSupportJob({ kind: 'answer', sourceId: 'ok', deadlineAt: Date.now() + 1000 });
  await dispatchSupportJob({ kind: 'answer', sourceId: 'bad', deadlineAt: Date.now() + 1000 });
  // Without Redis the job runs immediately, and a failure still reaches the user exactly once.
  assert.deepEqual(seen, ['process:ok', 'process:bad', 'failed:bad']);
}

(async () => {
  await testRetryPolicy();
  await testProcessorIdempotency();
  await testInlineDispatch();
  console.log('HackerHelp queue tests passed (retry policy and deadline, checkpointed idempotent processing, inline fallback).');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'error';

const apiError = (status: number | undefined, headers: Record<string, string> = {}, message = 'error', code?: string) =>
  Object.assign(new Error(message), { status, headers: new Headers(headers), code });

async function run() {
  const { withRetry, UpstreamUnavailableError, retryAfterMs } = await import('../services/retry');
  const sleeps: number[] = [];
  const sleep = async (ms: number) => { sleeps.push(ms); };

  const flaky = (failures: unknown[]) => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (failures.length) throw failures.shift();
      return 'ok';
    };
    return { fn, calls: () => calls };
  };

  // Transient 5xx then success: retried with bounded backoff.
  let op = flaky([apiError(503), apiError(502)]);
  assert.equal(await withRetry('test', op.fn, { sleep, baseDelayMs: 100, maxDelayMs: 1000 }), 'ok');
  assert.equal(op.calls(), 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps.every(ms => ms >= 0 && ms <= 1000));

  // Short Retry-After is honoured exactly.
  sleeps.length = 0;
  op = flaky([apiError(429, { 'retry-after-ms': '250' })]);
  assert.equal(await withRetry('test', op.fn, { sleep }), 'ok');
  assert.deepEqual(sleeps, [250]);

  // Regression: a daily-quota 429 asked the SDK to wait ~29 minutes and the bot hung.
  // Now it fails immediately with the server's requested delay attached for a queue to use.
  sleeps.length = 0;
  op = flaky([apiError(429, { 'retry-after': '1728' }, 'Rate limit reached for gpt-4.1-mini on requests per day (RPD)')]);
  await assert.rejects(withRetry('openai.chat', op.fn, { sleep }), (error: any) => {
    assert.ok(error instanceof UpstreamUnavailableError);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterMs, 1_728_000);
    assert.equal(error.operation, 'openai.chat');
    return true;
  });
  assert.equal(op.calls(), 1);
  assert.equal(sleeps.length, 0);

  // Long Retry-After without a quota message also fails fast.
  op = flaky([apiError(429, { 'retry-after': '120' })]);
  await assert.rejects(withRetry('test', op.fn, { sleep, maxDelayMs: 8000 }), /retry after 120s/);
  assert.equal(op.calls(), 1);

  // Quota exhaustion is never retried even without Retry-After.
  op = flaky([apiError(429, {}, 'You exceeded your current quota', 'insufficient_quota')]);
  await assert.rejects(withRetry('test', op.fn, { sleep }), /quota exhausted/);
  assert.equal(op.calls(), 1);

  // Non-transient errors pass through untouched and are not retried.
  const badRequest = apiError(400);
  op = flaky([badRequest]);
  await assert.rejects(withRetry('test', op.fn, { sleep }), error => error === badRequest);
  assert.equal(op.calls(), 1);

  // Network errors with no status are transient; attempts are bounded.
  op = flaky([new Error('fetch failed'), new Error('Connection error.'), new Error('Request timed out.')]);
  await assert.rejects(withRetry('test', op.fn, { sleep, maxAttempts: 3 }), /failed after 3 attempts/);
  assert.equal(op.calls(), 3);

  assert.equal(retryAfterMs(apiError(429, { 'retry-after': '2' })), 2000);
  assert.equal(retryAfterMs(apiError(429)), null);

  console.log('HackerHelp retry policy tests passed (bounded backoff, fail-fast on long Retry-After and quota).');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

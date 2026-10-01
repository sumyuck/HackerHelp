import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { validateStartupConfig } from '../config';
import { requireAdminToken } from '../middleware/admin-auth';

const validEnv = {
  DISCORD_TOKEN: 'token',
  DISCORD_CLIENT_ID: '123456789012345678',
  OPENAI_API_KEY: 'key',
  OPENAI_CHAT_MODEL: 'chat',
  OPENAI_EMBEDDING_MODEL: 'embed',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service'
};

function testConfigValidation() {
  assert.deepEqual(validateStartupConfig(validEnv), []);

  // Every missing variable is reported at once, not just the first.
  const missing = validateStartupConfig({ ...validEnv, DISCORD_TOKEN: '', OPENAI_API_KEY: '  ' });
  assert.deepEqual(missing, ['DISCORD_TOKEN is not set', 'OPENAI_API_KEY is not set']);

  assert.match(validateStartupConfig({ ...validEnv, SUPABASE_URL: 'http://x' }).join(), /https/);
  assert.match(validateStartupConfig({ ...validEnv, SUPER_ADMIN_IDS: '123456789012345678, @me' }).join(), /@me/);
  assert.deepEqual(validateStartupConfig({ ...validEnv, SUPER_ADMIN_IDS: '123456789012345678,987654321098765432' }), []);
  assert.match(validateStartupConfig({ ...validEnv, ADMIN_API_TOKEN: 'short' }).join(), /at least 32/);
  assert.match(validateStartupConfig({ ...validEnv, PORT: 'abc' }).join(), /PORT/);
  assert.match(validateStartupConfig({ ...validEnv, RAG_ANSWER_MIN_SIMILARITY: '4' }).join(), /between 0 and 1/);
  assert.match(validateStartupConfig({ ...validEnv, RAG_RETRIEVAL_FLOOR: 'high' }).join(), /between 0 and 1/);
  assert.match(validateStartupConfig({ ...validEnv, RAG_TOP_K: '50' }).join(), /RAG_TOP_K/);
  assert.deepEqual(validateStartupConfig({ ...validEnv, RAG_ANSWER_MIN_SIMILARITY: '0.45', RAG_TOP_K: '8' }), []);
}

function callMiddleware(authorization?: string) {
  let status = 200;
  let nextCalled = false;
  const req = { get: (name: string) => (name === 'authorization' ? authorization : undefined), path: '/x', ip: '127.0.0.1' } as unknown as Request;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } } as unknown as Response;
  requireAdminToken(req, res, (() => { nextCalled = true; }) as NextFunction);
  return { status, nextCalled };
}

function testAdminAuth() {
  const token = 'a'.repeat(64);

  // No token configured: the API is closed, not open.
  delete process.env.ADMIN_API_TOKEN;
  assert.deepEqual(callMiddleware(`Bearer ${token}`), { status: 503, nextCalled: false });

  process.env.ADMIN_API_TOKEN = token;
  assert.deepEqual(callMiddleware(`Bearer ${token}`), { status: 200, nextCalled: true });
  assert.deepEqual(callMiddleware(undefined), { status: 401, nextCalled: false });
  assert.deepEqual(callMiddleware(`Bearer ${token.slice(1)}`), { status: 401, nextCalled: false });
  assert.deepEqual(callMiddleware(`Basic ${token}`), { status: 401, nextCalled: false });
  // A Discord user ID (public information) is not a credential.
  assert.deepEqual(callMiddleware('Bearer 123456789012345678'), { status: 401, nextCalled: false });
  delete process.env.ADMIN_API_TOKEN;
}

try {
  testConfigValidation();
  testAdminAuth();
  console.log('HackerHelp hardening tests passed (config validation, admin API auth).');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

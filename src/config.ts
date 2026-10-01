/**
 * Startup configuration check. Every variable the running bot needs is
 * verified once, before any connection is opened, so a misconfigured
 * deployment fails immediately with one message listing everything missing
 * instead of crashing later on the first request that touches it.
 */
const REQUIRED = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'OPENAI_API_KEY',
  'OPENAI_CHAT_MODEL',
  'OPENAI_EMBEDDING_MODEL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY'
] as const;

const DISCORD_SNOWFLAKE = /^\d{17,20}$/;

export function validateStartupConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = REQUIRED
    .filter(name => !env[name]?.trim())
    .map(name => `${name} is not set`);

  if (env.SUPABASE_URL?.trim() && !/^https:\/\//.test(env.SUPABASE_URL.trim())) {
    problems.push('SUPABASE_URL must be an https:// URL');
  }

  const adminIds = (env.SUPER_ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  const invalidIds = adminIds.filter(id => !DISCORD_SNOWFLAKE.test(id));
  if (invalidIds.length) {
    problems.push(`SUPER_ADMIN_IDS contains values that are not Discord user IDs: ${invalidIds.join(', ')}`);
  }

  const token = env.ADMIN_API_TOKEN?.trim();
  if (token && token.length < 32) {
    problems.push('ADMIN_API_TOKEN must be at least 32 characters (generate one with `openssl rand -hex 32`)');
  }

  if (env.PORT && !/^\d+$/.test(env.PORT)) {
    problems.push('PORT must be a number');
  }

  return problems;
}

import 'dotenv/config';
import type { Server } from 'node:http';
import { logger } from './logger';
import { validateStartupConfig } from './config';
import app from './app';
import { connectDatabase, disconnectDatabase } from './database/connection';
import { startDiscordBot, stopDiscordBot } from './discord/bot';

const port = Number(process.env.PORT) || 3000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
let server: Server | undefined;
let shuttingDown = false;

async function bootstrap() {
  const problems = validateStartupConfig();
  if (problems.length) {
    logger.error('Invalid configuration; refusing to start.', { problems });
    process.exit(1);
  }
  if (!process.env.ADMIN_API_TOKEN?.trim()) {
    logger.warn('ADMIN_API_TOKEN is not set; the admin HTTP API (/api/*) is disabled.');
  }

  logger.info('Starting HackerHelp application bootstrapping...');

  // 1. Connect to MongoDB database
  await connectDatabase();

  // 2. Start Express API Server
  server = app.listen(port, () => {
    logger.info(`Express server running on http://localhost:${port}`);
  });

  // 3. Start Discord Bot Client
  await startDiscordBot();

  logger.info('HackerHelp services successfully started.');
}

/** Stops intake first (HTTP, Discord gateway), then closes the database. */
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}; shutting down gracefully.`);

  const forceExit = setTimeout(() => {
    logger.error(`Shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms; forcing exit.`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await stopDiscordBot();
    await disconnectDatabase();
    logger.info('Shutdown complete.');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error });
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', reason => logger.error('Unhandled promise rejection', { reason }));

bootstrap().catch(err => {
  logger.error('Bootstrapping failed:', err);
  process.exit(1);
});

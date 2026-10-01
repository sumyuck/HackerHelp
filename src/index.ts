import 'dotenv/config';
import winston from 'winston';
import app from './app';
import { connectDatabase } from './database/connection';
import { startDiscordBot } from './discord/bot';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

const port = process.env.PORT || 3000;

async function bootstrap() {
  logger.info('Starting HackerHelp application bootstrapping...');

  // 1. Connect to MongoDB database
  await connectDatabase();

  // 2. Start Express API Server
  app.listen(port, () => {
    logger.info(`Express server running on http://localhost:${port}`);
  });

  // 3. Start Discord Bot Client
  await startDiscordBot();

  logger.info('HackerHelp services successfully started.');
}

bootstrap().catch(err => {
  logger.error('Bootstrapping failed:', err);
  process.exit(1);
});

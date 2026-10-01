import mongoose from 'mongoose';
import { logger } from '../logger';

export async function connectDatabase(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/hackerhelp';
  // Fail fast on an unreachable server instead of buffering commands indefinitely.
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10_000 });
  logger.info('Successfully connected to MongoDB database.');

  mongoose.connection.on('disconnected', () => logger.warn('MongoDB connection lost; driver will retry.'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB connection re-established.'));
}

export async function disconnectDatabase(): Promise<void> {
  // An intentional disconnect is not a lost connection; don't log it as one.
  mongoose.connection.removeAllListeners('disconnected');
  await mongoose.disconnect();
}

import mongoose from 'mongoose';
import winston from 'winston';

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

export async function connectDatabase(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/hackerhelp';
  try {
    await mongoose.connect(mongoUri);
    logger.info('Successfully connected to MongoDB database.');
  } catch (error) {
    logger.error('Error connecting to MongoDB database:', error);
    process.exit(1);
  }
}

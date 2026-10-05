import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import apiRouter from './routes/api';
import { client } from './discord/bot';
import { redisConnected, supportQueueMode } from './queue/support-queue';

const app = express();

// Security Middlewares. No CORS: the API is server-to-server only, never called from a browser.
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.'
});

// API Router Mount
app.use('/api', limiter, apiRouter);

// Liveness: the process is up and serving HTTP.
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// Readiness: dependencies are connected, so the bot can actually do work.
app.get('/ready', (req, res) => {
  const checks = {
    mongodb: mongoose.connection.readyState === 1,
    discord: client.isReady()
  };
  const ready = Object.values(checks).every(Boolean);
  // Redis is reported but not required: without it support jobs run inline.
  res.status(ready ? 200 : 503).json({ status: ready ? 'READY' : 'NOT_READY', checks, queue: { mode: supportQueueMode(), redisConnected: redisConnected() } });
});

export default app;

import { createHash, timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { logger } from '../logger';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Guards the admin HTTP API with a shared bearer token (ADMIN_API_TOKEN).
 *
 * Identity claims in the request body (e.g. a Discord user ID) are not
 * authentication: Discord IDs are public, so anyone could impersonate an
 * admin. Discord-side actions are authorized through the interaction's user,
 * which Discord itself authenticates; the HTTP API is for operators/scripts.
 *
 * With no token configured the API is disabled rather than left open.
 */
export function requireAdminToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.ADMIN_API_TOKEN?.trim();
  if (!expected) {
    res.status(503).json({ success: false, error: 'Admin API is disabled: ADMIN_API_TOKEN is not configured.' });
    return;
  }

  const header = req.get('authorization') || '';
  const [scheme, provided] = header.split(' ');
  // Compare fixed-length digests so the check is constant-time regardless of input length.
  const valid = scheme === 'Bearer' && !!provided && timingSafeEqual(digest(provided), digest(expected));
  if (!valid) {
    logger.warn('Rejected admin API request with missing or invalid token', { path: req.path, ip: req.ip });
    res.status(401).json({ success: false, error: 'Unauthorized.' });
    return;
  }
  next();
}

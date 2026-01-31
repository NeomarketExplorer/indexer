/**
 * Simple in-memory IP-based rate limiter for Hono.
 * No external dependencies. Suitable for single-process deployments.
 * For multi-process, replace with Redis-backed limiter.
 */

import type { MiddlewareHandler } from 'hono';

interface BucketEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, BucketEntry>();

// Periodically clean up expired entries to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now >= entry.resetAt) {
      buckets.delete(key);
    }
  }
}, 60_000);

export interface RateLimitOptions {
  /** Max requests per window */
  max: number;
  /** Window size in milliseconds */
  windowMs: number;
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown';

    const now = Date.now();
    let entry = buckets.get(ip);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + options.windowMs };
      buckets.set(ip, entry);
    }

    entry.count++;

    c.header('X-RateLimit-Limit', String(options.max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, options.max - entry.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > options.max) {
      return c.json({ error: 'Too Many Requests' }, 429);
    }

    await next();
  };
}

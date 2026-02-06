/**
 * Token-bucket IP-based rate limiter for Hono.
 * Uses Redis if configured; falls back to in-memory buckets.
 * Suitable for single-process deployments without Redis.
 */

import type { MiddlewareHandler } from 'hono';
import { getRedis } from '../../lib/redis';

interface BucketEntry {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, BucketEntry>();

// Periodically clean up expired entries to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now - entry.lastRefill > 10 * 60_000) {
      buckets.delete(key);
    }
  }
}, 60_000);

export interface RateLimitOptions {
  /** Max steady-state requests per window */
  max: number;
  /** Burst capacity (defaults to max if not set) */
  burst?: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Optional key prefix to separate buckets */
  keyPrefix?: string;
}

const redisTokenBucketScript = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local tokens = tonumber(redis.call('HGET', key, 'tokens'))
local last = tonumber(redis.call('HGET', key, 'last'))

if tokens == nil or last == nil then
  tokens = capacity
  last = now
else
  local delta = now - last
  if delta > 0 then
    tokens = math.min(capacity, tokens + (delta * rate))
    last = now
  end
end

if tokens < 1 then
  redis.call('HSET', key, 'tokens', tokens, 'last', last)
  redis.call('PEXPIRE', key, ttl)
  return {0, tokens, last}
end

tokens = tokens - 1
redis.call('HSET', key, 'tokens', tokens, 'last', last)
redis.call('PEXPIRE', key, ttl)
return {1, tokens, last}
`;

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown';

    const now = Date.now();
    const windowMs = options.windowMs;
    const max = options.max;
    const capacity = options.burst ?? options.max;
    const refillRate = max / windowMs;
    const key = `${options.keyPrefix ?? 'rl'}:${ip}`;
    const redis = getRedis();

    let allowed = true;
    let remaining = 0;
    let resetAt = now;

    if (redis) {
      const ttl = Math.max(windowMs * 2, 60_000);
      const result = await redis.eval(
        redisTokenBucketScript,
        1,
        key,
        now,
        refillRate,
        capacity,
        ttl
      ) as unknown as [number, number, number];

      const [ok, tokens, last] = result;
      allowed = ok === 1;
      remaining = Math.max(0, Math.floor(tokens));
      resetAt = last;
    } else {
      let entry = buckets.get(key);
      if (!entry) {
        entry = { tokens: capacity, lastRefill: now };
        buckets.set(key, entry);
      }

      const elapsed = now - entry.lastRefill;
      if (elapsed > 0) {
        entry.tokens = Math.min(capacity, entry.tokens + elapsed * refillRate);
        entry.lastRefill = now;
      }

      if (entry.tokens < 1) {
        allowed = false;
        remaining = 0;
        resetAt = entry.lastRefill;
      } else {
        entry.tokens -= 1;
        remaining = Math.max(0, Math.floor(entry.tokens));
        resetAt = entry.lastRefill;
      }
    }

    const retryAfterMs = Math.max(0, Math.ceil((1 - remaining) / refillRate));
    const resetSeconds = Math.ceil((resetAt + retryAfterMs) / 1000);

    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(resetSeconds));

    if (!allowed) {
      c.header('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      return c.json({ error: 'Too Many Requests' }, 429);
    }

    await next();
  };
}

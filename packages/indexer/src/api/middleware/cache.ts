/**
 * Redis cache middleware for Hono
 * Composable middleware factory — each route specifies its own TTL
 */

import type { MiddlewareHandler } from 'hono';
import { getRedis } from '../../lib/redis';
import { getLogger } from '../../lib/logger';

const CACHE_PREFIX = 'neomarket:cache';

interface CacheOptions {
  /** Time to live in seconds */
  ttl: number;
}

/**
 * Build a deterministic cache key from the request
 */
function buildCacheKey(method: string, path: string, queryString: string): string {
  // Sort query params for deterministic keys
  const params = new URLSearchParams(queryString);
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const sortedQuery = new URLSearchParams(sorted).toString();

  return `${CACHE_PREFIX}:${method}:${path}${sortedQuery ? `:${sortedQuery}` : ''}`;
}

/**
 * Cache middleware factory
 * Usage: statsRouter.get('/', cached({ ttl: 120 }), handler);
 */
export function cached(options: CacheOptions): MiddlewareHandler {
  return async (c, next) => {
    const redis = getRedis();

    // No Redis configured — pass through
    if (!redis) {
      c.header('X-Cache', 'BYPASS');
      await next();
      return;
    }

    const url = new URL(c.req.url);
    const key = buildCacheKey(c.req.method, url.pathname, url.search);

    try {
      // Check cache
      const cachedData = await redis.get(key);

      if (cachedData) {
        c.header('X-Cache', 'HIT');
        c.header('Content-Type', 'application/json');
        return c.body(cachedData);
      }
    } catch (err) {
      // Redis error — don't crash, just skip cache
      getLogger().debug({ err }, 'Redis cache read error');
    }

    // Cache miss — run the handler
    c.header('X-Cache', 'MISS');
    await next();

    // Cache the response if it was successful
    if (c.res.status === 200) {
      try {
        const body = await c.res.clone().text();
        // Fire-and-forget — don't await
        redis.setex(key, options.ttl, body).catch((err) => {
          getLogger().debug({ err }, 'Redis cache write error');
        });
      } catch {
        // Ignore — caching is best-effort
      }
    }
  };
}

/**
 * Invalidate cached keys matching a pattern
 * Uses SCAN to avoid blocking Redis
 */
export async function invalidateCache(pattern: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;

  const logger = getLogger();
  let deleted = 0;

  try {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;

      if (keys.length > 0) {
        await redis.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== '0');

    if (deleted > 0) {
      logger.debug({ deleted, pattern }, 'Cache invalidated');
    }
  } catch (err) {
    logger.warn({ err, pattern }, 'Cache invalidation failed');
  }

  return deleted;
}

/**
 * Redis client singleton with graceful degradation
 * If REDIS_URL is not set, Redis features are disabled
 */

import Redis from 'ioredis';
import { getConfig } from './config';
import { getLogger } from './logger';

let redis: Redis | null = null;

/**
 * Get or create the Redis client
 * Returns null if REDIS_URL is not configured
 */
export function getRedis(): Redis | null {
  if (redis) {
    return redis;
  }

  const config = getConfig();
  if (!config.redisUrl) {
    return null;
  }

  const logger = getLogger();

  redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 10) {
        return null; // Stop retrying
      }
      return Math.min(times * 200, 5000);
    },
    lazyConnect: true,
  });

  redis.on('connect', () => {
    logger.info('Redis connected');
  });

  redis.on('error', (err) => {
    logger.error({ err }, 'Redis error');
  });

  redis.on('close', () => {
    logger.debug('Redis connection closed');
  });

  // Connect (non-blocking)
  redis.connect().catch((err) => {
    logger.warn({ err }, 'Redis initial connection failed, caching disabled');
  });

  return redis;
}

/**
 * Close the Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

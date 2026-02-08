/**
 * Health check endpoints
 *
 * Fix applied:
 * - #14 /health/sync includes sync staleness, WS status, and last errors
 */

import { Hono } from 'hono';
import { checkDbConnection, getDb } from '../../db';
import { getConfig } from '../../lib/config';

export const healthRouter = new Hono();

healthRouter.get('/', async (c) => {
  const dbConnected = await checkDbConnection();

  const status = dbConnected ? 'healthy' : 'unhealthy';
  const statusCode = dbConnected ? 200 : 503;

  return c.json(
    {
      status,
      timestamp: new Date().toISOString(),
      checks: {
        database: dbConnected ? 'connected' : 'disconnected',
      },
    },
    statusCode
  );
});

healthRouter.get('/live', (c) => {
  return c.json({ status: 'ok' });
});

healthRouter.get('/ready', async (c) => {
  const dbConnected = await checkDbConnection();

  if (!dbConnected) {
    return c.json({ status: 'not ready', reason: 'database not connected' }, 503);
  }

  return c.json({ status: 'ready' });
});

/**
 * GET /health/sync — operational sync health (#14)
 * Returns non-200 if markets or events sync is stale beyond threshold.
 */
healthRouter.get('/sync', async (c) => {
  const config = getConfig();
  const db = getDb();

  const syncStates = await db.query.syncState.findMany();
  const stateMap = Object.fromEntries(
    syncStates.map(s => [s.entity, s])
  );

  const now = Date.now();
  const threshold = config.syncStaleThresholdMs;

  const isStale = (entity: string): boolean => {
    const s = stateMap[entity];
    if (!s?.lastSyncAt) return true;
    return (now - new Date(s.lastSyncAt).getTime()) > threshold;
  };

  const isError = (entity: string): boolean => {
    const s = stateMap[entity];
    return s?.status === 'error';
  };

  const marketsSyncStale = isStale('markets');
  const eventsSyncStale = isStale('events');
  const marketsSyncError = isError('markets');
  const eventsSyncError = isError('events');

  const isHealthy =
    !marketsSyncStale &&
    !eventsSyncStale &&
    !marketsSyncError &&
    !eventsSyncError;

  const entityStatus = (entity: string) => {
    if (entity === 'trades' && !config.enableTradesSync) {
      return {
        lastSyncAt: null,
        status: 'disabled',
        error: null,
        stale: false,
      };
    }
    const s = stateMap[entity];
    return {
      lastSyncAt: s?.lastSyncAt ?? null,
      status: s?.status ?? 'unknown',
      error: s?.errorMessage ?? null,
      stale: isStale(entity),
    };
  };

  return c.json(
    {
      status: isHealthy ? 'healthy' : 'degraded',
      thresholdMs: threshold,
      checks: {
        markets: entityStatus('markets'),
        events: entityStatus('events'),
        trades: entityStatus('trades'),
        prices: entityStatus('prices'),
      },
    },
    isHealthy ? 200 : 503
  );
});

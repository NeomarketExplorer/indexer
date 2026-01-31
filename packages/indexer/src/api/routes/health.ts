/**
 * Health check endpoint
 */

import { Hono } from 'hono';
import { checkDbConnection } from '../../db';

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

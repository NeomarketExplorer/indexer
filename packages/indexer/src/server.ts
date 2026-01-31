/**
 * API Server - Hono HTTP server
 */

import { serve } from '@hono/node-server';
import { app } from './api';
import { getConfig } from './lib/config';
import { getLogger } from './lib/logger';
import { getDb, closeDb } from './db';

const logger = getLogger();
const config = getConfig();

async function startServer() {
  logger.info('Starting API server');

  // Ensure database is connected
  getDb();

  const server = serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  });

  logger.info({ host: config.host, port: config.port }, 'API server started');

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down API server');
    server.close();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((error) => {
  logger.error({ error }, 'Failed to start API server');
  process.exit(1);
});

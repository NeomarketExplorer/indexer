/**
 * API Server - Hono HTTP server
 *
 * Fix applied:
 * - #19 Schema verification at startup
 */

import { serve } from '@hono/node-server';
import { app } from './api';
import { getConfig } from './lib/config';
import { getLogger } from './lib/logger';
import { getDb, closeDb, verifySchema } from './db';
import { closeRedis } from './lib/redis';

const logger = getLogger();
const config = getConfig();

async function startServer() {
  logger.info('Starting API server');

  // Ensure database is connected
  getDb();

  // Verify schema exists (#19)
  const schemaOk = await verifySchema();
  if (!schemaOk) {
    logger.fatal('Database schema not found. Run "pnpm db:migrate" before starting.');
    process.exit(1);
  }

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
    await closeRedis();
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

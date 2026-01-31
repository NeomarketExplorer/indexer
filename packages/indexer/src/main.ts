/**
 * Main entry point - runs both API server and sync worker
 *
 * Fix applied:
 * - #19 Schema verification at startup
 */

import { serve } from '@hono/node-server';
import { app } from './api';
import { SyncOrchestrator } from './sync';
import { getConfig } from './lib/config';
import { getLogger } from './lib/logger';
import { getDb, closeDb, verifySchema } from './db';
import { closeRedis } from './lib/redis';

const logger = getLogger();
const config = getConfig();

async function main() {
  logger.info({ env: config.nodeEnv }, 'Starting Polymarket Indexer');

  // Ensure database is connected
  getDb();

  // Verify schema exists (#19)
  const schemaOk = await verifySchema();
  if (!schemaOk) {
    logger.fatal('Database schema not found. Run "pnpm db:migrate" before starting.');
    process.exit(1);
  }

  // Start API server first (so it's available during sync)
  const server = serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  });

  logger.info({
    host: config.host,
    port: config.port,
  }, 'API server started');

  // Start sync orchestrator (runs in background)
  const orchestrator = new SyncOrchestrator();
  orchestrator.start().then(() => {
    logger.info('Initial sync completed, periodic sync active');
  }).catch((error) => {
    logger.error({ error }, 'Sync orchestrator failed');
  });

  logger.info('Polymarket Indexer started (sync running in background)');

  // Add status endpoint to check sync status
  const printStatus = () => {
    const status = orchestrator.getStatus();
    logger.info({ status }, 'Sync status');
  };

  // Print status every 5 minutes
  const statusInterval = setInterval(printStatus, 5 * 60 * 1000);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down Polymarket Indexer');
    clearInterval(statusInterval);
    server.close();
    await orchestrator.stop();
    await closeRedis();
    await closeDb();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  logger.error({ error }, 'Failed to start Polymarket Indexer');
  process.exit(1);
});

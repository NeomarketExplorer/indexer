/**
 * Sync Worker - Background data synchronization
 *
 * Fixes applied:
 * - #19 Schema verification at startup
 */

import { SyncOrchestrator } from './sync';
import { getConfig } from './lib/config';
import { getLogger } from './lib/logger';
import { getDb, closeDb, verifySchema } from './db';
import { closeRedis } from './lib/redis';

const logger = getLogger();
const config = getConfig();

async function startWorker() {
  logger.info('Starting sync worker');

  // Ensure database is connected
  getDb();

  // Verify schema exists (#19)
  const schemaOk = await verifySchema();
  if (!schemaOk) {
    logger.fatal('Database schema not found. Run "pnpm db:migrate" before starting.');
    process.exit(1);
  }

  const orchestrator = new SyncOrchestrator();

  // Start sync
  await orchestrator.start();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down sync worker');
    await orchestrator.stop();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process running
  logger.info('Sync worker started');
}

startWorker().catch((error) => {
  logger.error({ error }, 'Failed to start sync worker');
  process.exit(1);
});

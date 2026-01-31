/**
 * Sync Worker - Background data synchronization
 */

import { SyncOrchestrator } from './sync';
import { getConfig } from './lib/config';
import { getLogger } from './lib/logger';
import { getDb, closeDb } from './db';

const logger = getLogger();
const config = getConfig();

async function startWorker() {
  logger.info('Starting sync worker');

  // Ensure database is connected
  getDb();

  const orchestrator = new SyncOrchestrator();

  // Start sync
  await orchestrator.start();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down sync worker');
    await orchestrator.stop();
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

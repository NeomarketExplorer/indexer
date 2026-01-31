/**
 * Backfill runner - standalone entrypoint for price history backfill (#16)
 *
 * Usage: pnpm backfill
 *
 * Fetches price history from CLOB API for active markets that
 * have no local price history yet. Processes the top 100 by volume.
 */

import { BackfillManager } from './sync';
import { getLogger } from './lib/logger';
import { getDb, closeDb, verifySchema } from './db';

const logger = getLogger();

async function runBackfill() {
  logger.info('Starting backfill runner');

  getDb();

  const schemaOk = await verifySchema();
  if (!schemaOk) {
    logger.fatal('Database schema not found. Run "pnpm db:migrate" first.');
    process.exit(1);
  }

  const backfill = new BackfillManager();
  await backfill.backfillAllMissingHistory();

  await closeDb();
  logger.info('Backfill complete');
}

runBackfill().catch((error) => {
  logger.error({ error }, 'Backfill failed');
  process.exit(1);
});

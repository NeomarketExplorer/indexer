/**
 * Database migration script
 * Run with: pnpm db:migrate
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { getConfig } from '../lib/config';
import { getLogger } from '../lib/logger';

async function runMigrations() {
  const config = getConfig();
  const logger = getLogger();

  logger.info('Running database migrations...');
  logger.info({ url: config.databaseUrl.replace(/:[^:@]+@/, ':****@') }, 'Database target');

  const migrationClient = postgres(config.databaseUrl, { max: 1 });
  const db = drizzle(migrationClient);

  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    logger.info('Migrations completed successfully');
  } catch (error) {
    logger.error({ error }, 'Migration failed');
    process.exit(1);
  } finally {
    await migrationClient.end();
  }
}

runMigrations();

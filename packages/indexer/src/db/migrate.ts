/**
 * Database migration script
 * Run with: pnpm db:migrate
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { getConfig } from '../lib/config';

async function runMigrations() {
  const config = getConfig();

  console.log('🔄 Running database migrations...');
  console.log(`📦 Database: ${config.databaseUrl.replace(/:[^:@]+@/, ':****@')}`);

  const migrationClient = postgres(config.databaseUrl, { max: 1 });
  const db = drizzle(migrationClient);

  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('✅ Migrations completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await migrationClient.end();
  }
}

runMigrations();

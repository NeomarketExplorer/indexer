/**
 * Drizzle database client
 */

import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema';
import { getConfig } from '../lib/config';
import { getLogger } from '../lib/logger';

export * from './schema';

let db: PostgresJsDatabase<typeof schema> | null = null;
let queryClient: postgres.Sql | null = null;

/**
 * Get or create the database connection
 */
export function getDb(): PostgresJsDatabase<typeof schema> {
  if (db) {
    return db;
  }

  const config = getConfig();
  const logger = getLogger();

  logger.info({ url: config.databaseUrl.replace(/:[^:@]+@/, ':****@') }, 'Connecting to database');

  queryClient = postgres(config.databaseUrl, {
    max: config.dbPoolMax,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: {
      statement_timeout: config.queryTimeoutMs,
    },
  });

  db = drizzle(queryClient, { schema });

  return db;
}

/**
 * Close the database connection
 */
export async function closeDb(): Promise<void> {
  if (queryClient) {
    await queryClient.end();
    queryClient = null;
    db = null;
    getLogger().info('Database connection closed');
  }
}

/**
 * Check database connectivity
 */
export async function checkDbConnection(): Promise<boolean> {
  try {
    const database = getDb();
    await database.execute(sql`SELECT 1`);
    return true;
  } catch (error) {
    getLogger().error({ error }, 'Database connection check failed');
    return false;
  }
}

/**
 * Verify that required tables exist (migration check).
 * Returns false if core tables are missing — caller should abort.
 */
export async function verifySchema(): Promise<boolean> {
  try {
    const database = getDb();
    await database.execute(sql`SELECT 1 FROM events LIMIT 0`);
    await database.execute(sql`SELECT 1 FROM markets LIMIT 0`);
    await database.execute(sql`SELECT 1 FROM sync_state LIMIT 0`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Database helpers for integration tests
 * Provides setup, seeding, and cleanup utilities
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema';

const TEST_DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/polymarket_test';

let testClient: postgres.Sql | null = null;
let testDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Set up the test database: create if needed and run migrations
 */
export async function setupTestDb() {
  // Connect to default 'postgres' database to create test database
  const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
  const adminClient = postgres(adminUrl, { max: 1 });

  try {
    // Create test database if it doesn't exist
    const existing = await adminClient`
      SELECT 1 FROM pg_database WHERE datname = 'polymarket_test'
    `;
    if (existing.length === 0) {
      await adminClient.unsafe('CREATE DATABASE polymarket_test');
    }
  } finally {
    await adminClient.end();
  }

  // Connect to test database and run migrations
  const migrationClient = postgres(TEST_DB_URL, { max: 1 });
  const migrationDb = drizzle(migrationClient);

  try {
    await migrate(migrationDb, { migrationsFolder: './drizzle' });
  } finally {
    await migrationClient.end();
  }

  // Create the shared test connection
  testClient = postgres(TEST_DB_URL, { max: 5 });
  testDb = drizzle(testClient, { schema });

  return testDb;
}

/**
 * Get the test database instance
 */
export function getTestDb() {
  if (!testDb) {
    throw new Error('Test database not initialized. Call setupTestDb() first.');
  }
  return testDb;
}

/**
 * Seed the test database with known fixture data
 */
export async function seedTestData() {
  const db = getTestDb();

  // Insert test events
  await db.insert(schema.events).values([
    {
      id: 'event-1',
      title: 'Will Bitcoin reach $100k?',
      slug: 'bitcoin-100k',
      description: 'Market for Bitcoin price prediction',
      volume: 5000000,
      volume24hr: 250000,
      liquidity: 1000000,
      active: true,
      closed: false,
      archived: false,
    },
    {
      id: 'event-2',
      title: 'US Presidential Election 2024',
      slug: 'us-election-2024',
      description: 'Who will win the US presidential election?',
      volume: 10000000,
      volume24hr: 500000,
      liquidity: 3000000,
      active: false,
      closed: true,
      archived: false,
    },
    {
      id: 'event-3',
      title: 'Ethereum merge successful?',
      slug: 'eth-merge',
      description: 'Will the Ethereum merge be completed successfully?',
      volume: 2000000,
      volume24hr: 0,
      liquidity: 0,
      active: false,
      closed: true,
      archived: true,
    },
  ]).onConflictDoNothing();

  // Insert test markets
  await db.insert(schema.markets).values([
    {
      id: 'market-1',
      eventId: 'event-1',
      conditionId: 'cond-1',
      question: 'Will Bitcoin reach $100k by end of 2025?',
      description: 'Resolves YES if BTC hits $100,000',
      slug: 'btc-100k-2025',
      outcomes: ['Yes', 'No'],
      outcomeTokenIds: ['token-1a', 'token-1b'],
      outcomePrices: [0.65, 0.35],
      volume: 3000000,
      volume24hr: 150000,
      liquidity: 600000,
      category: 'Crypto',
      active: true,
      closed: false,
      archived: false,
      bestBid: 0.64,
      bestAsk: 0.66,
      spread: 0.02,
      lastTradePrice: 0.65,
    },
    {
      id: 'market-2',
      eventId: 'event-1',
      conditionId: 'cond-2',
      question: 'Will Bitcoin reach $150k by end of 2025?',
      description: 'Resolves YES if BTC hits $150,000',
      slug: 'btc-150k-2025',
      outcomes: ['Yes', 'No'],
      outcomeTokenIds: ['token-2a', 'token-2b'],
      outcomePrices: [0.25, 0.75],
      volume: 2000000,
      volume24hr: 100000,
      liquidity: 400000,
      category: 'Crypto',
      active: true,
      closed: false,
      archived: false,
    },
    {
      id: 'market-3',
      eventId: 'event-2',
      conditionId: 'cond-3',
      question: 'Will the Democratic candidate win?',
      description: 'Resolves to the winner of the 2024 US Presidential election',
      slug: 'dem-win-2024',
      outcomes: ['Yes', 'No'],
      outcomeTokenIds: ['token-3a', 'token-3b'],
      outcomePrices: [0.48, 0.52],
      volume: 8000000,
      volume24hr: 400000,
      liquidity: 2500000,
      category: 'Politics',
      active: false,
      closed: true,
      archived: false,
      resolved: true,
      winningOutcome: 1,
    },
    {
      id: 'market-4',
      eventId: 'event-3',
      conditionId: 'cond-4',
      question: 'Will Ethereum merge happen before Q4 2022?',
      description: 'Resolves YES if the merge completes',
      slug: 'eth-merge-q4',
      outcomes: ['Yes', 'No'],
      outcomeTokenIds: ['token-4a', 'token-4b'],
      outcomePrices: [1, 0],
      volume: 2000000,
      volume24hr: 0,
      liquidity: 0,
      category: 'Crypto',
      active: false,
      closed: true,
      archived: true,
    },
  ]).onConflictDoNothing();

  // Insert test sync state
  await db.insert(schema.syncState).values([
    {
      entity: 'markets',
      status: 'idle',
      lastSyncAt: new Date(),
      metadata: { count: 4, durationMs: 1200 },
    },
    {
      entity: 'events',
      status: 'idle',
      lastSyncAt: new Date(),
      metadata: { count: 3, durationMs: 800 },
    },
  ]).onConflictDoNothing();

  // Insert some test trades
  await db.execute(sql`
    INSERT INTO trades (id, market_id, token_id, side, price, size, timestamp)
    VALUES
      ('trade-1', 'market-1', 'token-1a', 'BUY', 0.65, 100, NOW() - interval '1 hour'),
      ('trade-2', 'market-1', 'token-1a', 'SELL', 0.64, 50, NOW() - interval '30 minutes'),
      ('trade-3', 'market-3', 'token-3a', 'BUY', 0.48, 200, NOW() - interval '2 days')
    ON CONFLICT (id) DO NOTHING
  `);

  // Insert some price history
  await db.insert(schema.priceHistory).values([
    {
      marketId: 'market-1',
      tokenId: 'token-1a',
      timestamp: new Date(Date.now() - 3600_000),
      price: 0.63,
      source: 'clob',
    },
    {
      marketId: 'market-1',
      tokenId: 'token-1a',
      timestamp: new Date(Date.now() - 1800_000),
      price: 0.65,
      source: 'websocket',
    },
  ]);
}

/**
 * Truncate all tables between test suites
 */
export async function cleanDb() {
  const db = getTestDb();

  await db.execute(sql`
    TRUNCATE TABLE positions, price_history, trades, market_tags, event_tags,
    markets, events, tags, wallets, sync_state CASCADE
  `);
}

/**
 * Close the test database connection
 */
export async function closeTestDb() {
  if (testClient) {
    await testClient.end();
    testClient = null;
    testDb = null;
  }
}

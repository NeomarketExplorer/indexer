/**
 * price_history idempotency tests
 *
 * Ensures ON CONFLICT DO NOTHING works (requires a matching unique constraint).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import * as schema from '../schema';
import { setupTestDb, cleanDb, closeTestDb, getTestDb } from '../../test/db-helpers';

describe('price_history uniqueness', () => {
  beforeAll(async () => {
    await setupTestDb();
    await cleanDb();

    const db = getTestDb();

    await db.insert(schema.events).values({
      id: 'event-ph-1',
      title: 'Event',
      active: true,
      closed: false,
      archived: false,
    });

    await db.insert(schema.markets).values({
      id: 'market-ph-1',
      eventId: 'event-ph-1',
      conditionId: 'cond-ph-1',
      question: 'Question',
      outcomes: ['Yes', 'No'],
      outcomeTokenIds: ['token-ph-1a', 'token-ph-1b'],
      outcomePrices: [0.5, 0.5],
      active: true,
      closed: false,
      archived: false,
    });
  });

  afterAll(async () => {
    await cleanDb();
    await closeTestDb();
  });

  it('dedupes inserts on (marketId, tokenId, timestamp, source)', async () => {
    const db = getTestDb();
    const ts = new Date('2026-02-08T00:00:00.000Z');

    const row = {
      marketId: 'market-ph-1',
      tokenId: 'token-ph-1a',
      timestamp: ts,
      price: 0.42,
      source: 'websocket' as const,
    };

    await db.insert(schema.priceHistory)
      .values(row)
      .onConflictDoNothing({
        target: [schema.priceHistory.marketId, schema.priceHistory.tokenId, schema.priceHistory.timestamp, schema.priceHistory.source],
      });

    await db.insert(schema.priceHistory)
      .values(row)
      .onConflictDoNothing({
        target: [schema.priceHistory.marketId, schema.priceHistory.tokenId, schema.priceHistory.timestamp, schema.priceHistory.source],
      });

    // postgres-js can be picky about binding Date values in raw sql; cast from ISO string.
    const [{ count }] = await db.execute(sql`
      SELECT count(*)::int AS count
      FROM price_history
      WHERE market_id = 'market-ph-1'
        AND token_id = 'token-ph-1a'
        AND "timestamp" = ${ts.toISOString()}::timestamptz
        AND source = 'websocket'
    `) as unknown as Array<{ count: number }>;

    expect(count).toBe(1);
  });
});

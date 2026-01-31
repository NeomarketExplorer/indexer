/**
 * Historical data backfill from CLOB API
 */

import { eq, sql, desc } from 'drizzle-orm';
import { createClobClient, type PriceHistoryPoint } from '@app/api/clob';
import { getDb, markets, priceHistory } from '../db';
import { createChildLogger } from '../lib/logger';

export class BackfillManager {
  private logger = createChildLogger({ module: 'backfill' });
  private clobClient = createClobClient();

  /**
   * Backfill price history for a specific market
   */
  async backfillMarketHistory(
    marketId: string,
    interval: 'max' | '1w' | '1d' | '6h' | '1h' = 'max'
  ): Promise<number> {
    const db = getDb();

    // Get market to find condition ID
    const market = await db.query.markets.findFirst({
      where: eq(markets.id, marketId),
      columns: {
        id: true,
        conditionId: true,
        outcomeTokenIds: true,
      },
    });

    if (!market) {
      this.logger.warn({ marketId }, 'Market not found for backfill');
      return 0;
    }

    const tokenIds = market.outcomeTokenIds as string[];
    if (tokenIds.length === 0) {
      this.logger.warn({ marketId }, 'No token IDs found for market');
      return 0;
    }

    let totalInserted = 0;

    try {
      // Fetch price history from CLOB API
      const history = await this.clobClient.getPriceHistory(
        market.conditionId,
        interval,
        60 // fidelity in seconds
      );

      if (history.length === 0) {
        this.logger.debug({ marketId }, 'No price history found');
        return 0;
      }

      this.logger.info({
        marketId,
        points: history.length,
        interval,
      }, 'Fetched price history');

      // Insert in batches
      const batchSize = 100;
      for (let i = 0; i < history.length; i += batchSize) {
        const batch = history.slice(i, i + batchSize);
        const values = batch.map((point: PriceHistoryPoint) => ({
          marketId: market.id,
          tokenId: tokenIds[0], // Primary outcome token
          timestamp: new Date(point.t * 1000), // Convert unix timestamp
          price: point.p,
          source: 'clob' as const,
        }));

        // Upsert to avoid duplicates
        await db.insert(priceHistory)
          .values(values)
          .onConflictDoNothing();

        totalInserted += batch.length;
      }

      this.logger.info({
        marketId,
        inserted: totalInserted,
      }, 'Backfill completed');

    } catch (error) {
      this.logger.error({ marketId, error }, 'Failed to backfill price history');
    }

    return totalInserted;
  }

  /**
   * Backfill all active markets that have no price history
   */
  async backfillAllMissingHistory(): Promise<void> {
    const db = getDb();

    this.logger.info('Starting backfill of missing price history');

    // Find markets without price history
    const marketsWithoutHistory = await db.execute(sql`
      SELECT m.id, m.condition_id
      FROM markets m
      LEFT JOIN (
        SELECT DISTINCT market_id FROM price_history
      ) ph ON m.id = ph.market_id
      WHERE ph.market_id IS NULL
        AND m.active = true
      ORDER BY m.volume_24hr DESC NULLS LAST
      LIMIT 100
    `);

    this.logger.info({ count: marketsWithoutHistory.length }, 'Found markets without history');

    let processed = 0;
    for (const row of marketsWithoutHistory as unknown as Array<{ id: string }>) {
      await this.backfillMarketHistory(row.id, '1w');
      processed++;

      // Rate limit: 100ms between requests
      await new Promise(resolve => setTimeout(resolve, 100));

      if (processed % 10 === 0) {
        this.logger.info({ processed, total: marketsWithoutHistory.length }, 'Backfill progress');
      }
    }

    this.logger.info({ processed }, 'Backfill completed');
  }

  /**
   * Get backfill status for a market
   */
  async getBackfillStatus(marketId: string): Promise<{
    hasHistory: boolean;
    pointCount: number;
    oldestTimestamp: Date | null;
    newestTimestamp: Date | null;
  }> {
    const db = getDb();

    const stats = await db
      .select({
        count: sql<number>`count(*)`,
        oldest: sql<Date>`min(timestamp)`,
        newest: sql<Date>`max(timestamp)`,
      })
      .from(priceHistory)
      .where(eq(priceHistory.marketId, marketId));

    const result = stats[0];

    return {
      hasHistory: (result?.count ?? 0) > 0,
      pointCount: result?.count ?? 0,
      oldestTimestamp: result?.oldest ?? null,
      newestTimestamp: result?.newest ?? null,
    };
  }
}

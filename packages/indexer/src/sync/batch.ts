/**
 * Batch sync manager - periodic polling of APIs
 * Optimized for high volume: ~26,000 markets, ~7,000 events
 *
 * Fixes applied:
 * - #1  Batched multi-row upserts instead of per-row INSERTs
 * - #2  Per-entity sync locks (events, markets, trades independent)
 * - #3  Trades sync wired into periodic loop
 * - #5  onMarketsSynced callback for WS resubscribe
 * - #10 searchVector computed on upsert
 * - #11 Targeted cache invalidation (not global wipe)
 * - #17 Single source of truth for market data (markets sync only)
 */

import { createHash } from 'node:crypto';
import { eq, desc, sql } from 'drizzle-orm';
import { createGammaClient, type GammaMarket, type GammaEvent } from '@app/api/gamma';
import { createClobClient } from '@app/api/clob';
import { getDb, markets, events, syncState, type NewMarket, type NewEvent } from '../db';
import { getConfig } from '../lib/config';
import { createChildLogger } from '../lib/logger';
import { invalidateCache } from '../api/middleware/cache';

export class BatchSyncManager {
  private logger = createChildLogger({ module: 'batch-sync' });
  private gammaClient = createGammaClient();
  private clobClient = createClobClient();
  private config = getConfig();
  private intervals: NodeJS.Timeout[] = [];

  // Per-entity sync locks (#2)
  private isSyncingEvents = false;
  private isSyncingMarkets = false;
  private isSyncingTrades = false;

  private lastSyncAt: Date | null = null;
  private syncError: string | null = null;
  private syncProgress = { markets: 0, events: 0, trades: 0 };

  // Cached event→market linkages from last events sync (#17)
  private eventMarketPairs: Array<{ marketId: string; eventId: string }> = [];

  // Callback fired after markets sync succeeds (#5)
  private onMarketsSynced?: () => Promise<void>;

  setOnMarketsSynced(callback: () => Promise<void>): void {
    this.onMarketsSynced = callback;
  }

  /**
   * Run initial full sync of all data (includes closed items)
   */
  async runInitialSync(): Promise<void> {
    this.logger.info('Starting initial sync (expect ~26k open markets, ~7k open events + closed)');

    // Sync events first (they're parents of markets)
    await this.syncEvents({ includeClosed: true });

    // Then sync markets
    await this.syncMarkets({ includeClosed: true });

    // Re-apply event→market linkages now that markets exist
    await this.applyEventMarketLinks();

    this.logger.info('Initial sync completed');
  }

  /**
   * Start periodic sync intervals
   */
  startPeriodicSync(): void {
    this.logger.info('Starting periodic sync');

    // Markets sync every 5 minutes
    const marketsInterval = setInterval(
      () => this.syncMarkets(),
      this.config.marketsSyncInterval
    );
    this.intervals.push(marketsInterval);

    // Events sync every 5 minutes (staggered by 2.5 min)
    setTimeout(() => {
      const eventsInterval = setInterval(
        () => this.syncEvents(),
        this.config.marketsSyncInterval
      );
      this.intervals.push(eventsInterval);
    }, this.config.marketsSyncInterval / 2);

    // Trades sync on its own interval (#3)
    const tradesInterval = setInterval(
      () => this.syncAllTrades(),
      this.config.tradesSyncInterval
    );
    this.intervals.push(tradesInterval);

    // Expiration audit every 60s — decoupled from sync so expired
    // items are caught even while a long sync is still running
    const auditInterval = setInterval(
      () => this.runExpirationAudit(),
      60_000
    );
    this.intervals.push(auditInterval);

    this.logger.info({
      marketsSyncInterval: this.config.marketsSyncInterval,
      tradesSyncInterval: this.config.tradesSyncInterval,
    }, 'Periodic sync started');
  }

  /**
   * Stop all periodic syncs
   */
  stop(): void {
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    this.logger.info('Periodic sync stopped');
  }

  // ─── Events ──────────────────────────────────────────────

  async syncEvents({ includeClosed = false } = {}): Promise<void> {
    if (this.isSyncingEvents) {
      this.logger.warn('Events sync already in progress, skipping');
      return;
    }

    this.isSyncingEvents = true;
    this.syncError = null;
    this.syncProgress.events = 0;
    this.eventMarketPairs = [];

    const startTime = Date.now();
    const FETCH_BATCH_SIZE = this.config.marketsBatchSize;

    try {
      await this.updateSyncState('events', 'syncing');
      this.logger.info({ includeClosed }, 'Syncing events from Gamma API');

      let totalEvents = 0;

      const fetchByFilter = async (filter: { closed: boolean }) => {
        let offset = 0;
        while (true) {
          const batch = await this.gammaClient.getEvents({
            limit: FETCH_BATCH_SIZE,
            offset,
            closed: filter.closed,
          });

          if (batch.length === 0) break;

          const batchStart = Date.now();
          await this.upsertEventsBatch(batch);
          this.collectEventMarketPairs(batch);
          this.logger.debug({ batchSize: batch.length, durationMs: Date.now() - batchStart }, 'Events batch upserted');

          offset += batch.length;
          totalEvents += batch.length;
          this.syncProgress.events = totalEvents;

          if (totalEvents % 1000 === 0 || batch.length < FETCH_BATCH_SIZE) {
            this.logger.info({ synced: totalEvents }, 'Events sync progress');
          }

          if (batch.length < FETCH_BATCH_SIZE) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      };

      await fetchByFilter({ closed: false });
      if (includeClosed) {
        await fetchByFilter({ closed: true });
      }

      // Link markets to events (works for markets that already exist)
      await this.applyEventMarketLinks();

      // Deactivate events whose end date has passed
      await this.auditExpiredEvents();

      await this.updateSyncState('events', 'idle', { count: totalEvents, durationMs: Date.now() - startTime });

      // Targeted invalidation (#11)
      await invalidateCache('neomarket:cache:GET:/events*');
      await invalidateCache('neomarket:cache:GET:/stats*');

      this.logger.info({ totalEvents, durationMs: Date.now() - startTime }, 'Events sync completed');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.syncError = errorMessage;
      this.logger.error({ error: errorMessage }, 'Events sync failed');
      await this.updateSyncState('events', 'error', null, errorMessage);
    } finally {
      this.isSyncingEvents = false;
    }
  }

  // ─── Markets ─────────────────────────────────────────────

  async syncMarkets({ includeClosed = false } = {}): Promise<void> {
    if (this.isSyncingMarkets) {
      this.logger.warn('Markets sync already in progress, skipping');
      return;
    }

    this.isSyncingMarkets = true;
    this.syncError = null;
    this.syncProgress.markets = 0;

    const startTime = Date.now();
    const FETCH_BATCH_SIZE = this.config.marketsBatchSize;

    try {
      await this.updateSyncState('markets', 'syncing');
      this.logger.info({ includeClosed }, 'Syncing markets from Gamma API');

      let totalMarkets = 0;

      const fetchByFilter = async (filter: { closed: boolean }) => {
        let offset = 0;
        while (true) {
          const batch = await this.gammaClient.getMarkets({
            limit: FETCH_BATCH_SIZE,
            offset,
            closed: filter.closed,
          });

          if (batch.length === 0) break;

          const batchStart = Date.now();
          await this.upsertMarketsBatch(batch);
          this.logger.debug({ batchSize: batch.length, durationMs: Date.now() - batchStart }, 'Markets batch upserted');

          offset += batch.length;
          totalMarkets += batch.length;
          this.syncProgress.markets = totalMarkets;

          if (totalMarkets % 2000 === 0 || batch.length < FETCH_BATCH_SIZE) {
            this.logger.info({ synced: totalMarkets }, 'Markets sync progress');
          }

          if (batch.length < FETCH_BATCH_SIZE) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      };

      await fetchByFilter({ closed: false });
      if (includeClosed) {
        await fetchByFilter({ closed: true });
      }

      // Deactivate markets whose end date has passed
      await this.auditExpiredMarkets();

      await this.updateSyncState('markets', 'idle', { count: totalMarkets, durationMs: Date.now() - startTime });

      // Targeted invalidation (#11)
      await invalidateCache('neomarket:cache:GET:/markets*');
      await invalidateCache('neomarket:cache:GET:/stats*');

      this.lastSyncAt = new Date();
      this.logger.info({ totalMarkets, durationMs: Date.now() - startTime }, 'Markets sync completed');

      // Notify listeners (e.g. WS resubscribe) (#5)
      if (this.onMarketsSynced) {
        this.onMarketsSynced().catch(err =>
          this.logger.error({ err }, 'Post-markets-sync callback failed')
        );
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.syncError = errorMessage;
      this.logger.error({ error: errorMessage }, 'Markets sync failed');
      await this.updateSyncState('markets', 'error', null, errorMessage);
    } finally {
      this.isSyncingMarkets = false;
    }
  }

  // ─── Trades (#3) ─────────────────────────────────────────

  async syncAllTrades(): Promise<void> {
    if (this.isSyncingTrades) {
      this.logger.warn('Trades sync already in progress, skipping');
      return;
    }

    this.isSyncingTrades = true;
    this.syncProgress.trades = 0;
    const startTime = Date.now();

    try {
      await this.updateSyncState('trades', 'syncing');
      const db = getDb();

      // Top active markets by 24h volume
      const activeMarkets = await db.query.markets.findMany({
        where: eq(markets.active, true),
        orderBy: [desc(markets.volume24hr)],
        limit: this.config.tradesSyncMarketLimit,
        columns: { id: true, outcomeTokenIds: true },
      });

      let totalTrades = 0;
      let synced = 0;

      for (const market of activeMarkets) {
        const tokenIds = market.outcomeTokenIds as string[];
        for (const tokenId of tokenIds) {
          const result = await this.syncTrades(tokenId, market.id);
          totalTrades += result.count;
          // Rate limit between API calls
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        synced++;
        this.syncProgress.trades = synced;
      }

      await this.updateSyncState('trades', 'idle', {
        count: totalTrades,
        marketsProcessed: activeMarkets.length,
        durationMs: Date.now() - startTime,
      });

      this.logger.info({
        totalTrades,
        marketsProcessed: activeMarkets.length,
        durationMs: Date.now() - startTime,
      }, 'Trades sync completed');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error: errorMessage }, 'Trades sync failed');
      await this.updateSyncState('trades', 'error', null, errorMessage);
    } finally {
      this.isSyncingTrades = false;
    }
  }

  /**
   * Sync trades from CLOB API for a specific market token
   */
  async syncTrades(tokenId: string, marketId: string): Promise<{ success: boolean; count: number }> {
    const db = getDb();

    try {
      const trades = await this.clobClient.getTrades(tokenId, this.config.tradesBatchSize);

      for (const trade of trades) {
        // Deterministic fallback ID: hash a composite of all distinguishing fields
        // to avoid collisions from the weak asset_id-timestamp pair.
        const tradeId = trade.id ?? createHash('sha256')
          .update([
            trade.asset_id,
            trade.side,
            trade.price,
            trade.size,
            trade.timestamp ?? '',
            trade.taker_order_id ?? '',
            trade.transaction_hash ?? '',
          ].join('|'))
          .digest('hex');

        await db.execute(sql`
          INSERT INTO trades (id, market_id, token_id, side, price, size, timestamp, taker_order_id, transaction_hash, fee_rate_bps)
          VALUES (
            ${tradeId},
            ${marketId},
            ${trade.asset_id},
            ${trade.side},
            ${parseFloat(trade.price)},
            ${parseFloat(trade.size)},
            ${trade.timestamp ? new Date(trade.timestamp) : new Date()},
            ${trade.taker_order_id ?? null},
            ${trade.transaction_hash ?? null},
            ${trade.fee_rate_bps ? parseInt(trade.fee_rate_bps, 10) : null}
          )
          ON CONFLICT (id) DO NOTHING
        `);
      }

      this.logger.debug({ tokenId, count: trades.length }, 'Synced trades');
      return { success: true, count: trades.length };
    } catch (error) {
      this.logger.error({ tokenId, error }, 'Failed to sync trades');
      return { success: false, count: 0 };
    }
  }

  // ─── Helpers ─────────────────────────────────────────────

  private async updateSyncState(
    entity: string,
    status: string,
    metadata?: Record<string, unknown> | null,
    errorMessage?: string
  ): Promise<void> {
    const db = getDb();
    await db.insert(syncState)
      .values({
        entity,
        status,
        lastSyncAt: new Date(),
        metadata: metadata ?? undefined,
        errorMessage: errorMessage ?? undefined,
      })
      .onConflictDoUpdate({
        target: syncState.entity,
        set: {
          status,
          lastSyncAt: new Date(),
          metadata: metadata ?? undefined,
          errorMessage: errorMessage ?? null,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Batch upsert events (#1). Writes events only — does not touch markets table.
   */
  private async upsertEventsBatch(gammaEvents: GammaEvent[]): Promise<void> {
    if (gammaEvents.length === 0) return;
    const db = getDb();

    const values: NewEvent[] = gammaEvents.map(event => ({
      id: event.id,
      title: event.title,
      slug: event.slug,
      description: event.description,
      image: event.image,
      icon: event.icon,
      endDate: event.end_date ? new Date(event.end_date) : undefined,
      volume: event.volume ?? 0,
      volume24hr: event.volume24hr ?? 0,
      liquidity: event.liquidity ?? 0,
      active: event.active ?? true,
      closed: event.closed ?? false,
      archived: event.archived ?? false,
      updatedAt: new Date(),
    }));

    await db.insert(events)
      .values(values)
      .onConflictDoUpdate({
        target: events.id,
        set: {
          title: sql`excluded.title`,
          slug: sql`excluded.slug`,
          description: sql`excluded.description`,
          image: sql`excluded.image`,
          icon: sql`excluded.icon`,
          endDate: sql`excluded.end_date`,
          volume: sql`excluded.volume`,
          volume24hr: sql`excluded.volume_24hr`,
          liquidity: sql`excluded.liquidity`,
          active: sql`excluded.active`,
          closed: sql`excluded.closed`,
          archived: sql`excluded.archived`,
          updatedAt: sql`excluded.updated_at`,
        },
      });

    // Compute search vectors (#10)
    const ids = gammaEvents.map(e => e.id);
    const idList = sql.join(ids.map(id => sql`${id}`), sql`,`);
    await db.execute(sql`
      UPDATE events
      SET search_vector = to_tsvector('english', title || ' ' || coalesce(description, ''))
      WHERE id IN (${idList})
    `);
  }

  /**
   * Collect event→market pairs for eventId linking (#17).
   *
   * Relies on the `markets` array nested in Gamma event responses.
   * The Gamma /events endpoint includes nested markets by default.
   * If the array is absent for an event, we log a warning — there is
   * no alternative Gamma endpoint that provides event→market mappings.
   */
  private collectEventMarketPairs(gammaEvents: GammaEvent[]): void {
    let missingCount = 0;
    for (const event of gammaEvents) {
      const nested = event.markets;
      if (!nested || nested.length === 0) {
        missingCount++;
        continue;
      }
      for (const market of nested) {
        if (market.id) {
          this.eventMarketPairs.push({ marketId: market.id, eventId: event.id });
        }
      }
    }
    if (missingCount > 0) {
      this.logger.warn(
        { missingCount, total: gammaEvents.length },
        'Some events had no nested markets — their markets will not be linked'
      );
    }
  }

  /**
   * Apply cached event→market linkages via batch UPDATE (#17)
   */
  private async applyEventMarketLinks(): Promise<void> {
    if (this.eventMarketPairs.length === 0) return;
    const db = getDb();

    const chunkSize = 5000;
    for (let i = 0; i < this.eventMarketPairs.length; i += chunkSize) {
      const chunk = this.eventMarketPairs.slice(i, i + chunkSize);
      const valuesSql = chunk.map(p => sql`(${p.marketId}::text, ${p.eventId}::text)`);
      const valuesList = sql.join(valuesSql, sql`, `);
      await db.execute(sql`
        UPDATE markets m SET event_id = v.event_id
        FROM (VALUES ${valuesList}) AS v(market_id, event_id)
        WHERE m.id = v.market_id
      `);
    }
  }

  /**
   * Batch upsert markets (#1). Single source of truth for market data (#17).
   * Does NOT overwrite event_id — that is managed by events sync.
   */
  private async upsertMarketsBatch(gammaMarkets: GammaMarket[]): Promise<void> {
    if (gammaMarkets.length === 0) return;
    const db = getDb();

    const values: NewMarket[] = gammaMarkets.map(market => ({
      id: market.id,
      conditionId: market.condition_id,
      question: market.question,
      description: market.description,
      slug: market.slug,
      outcomes: market.outcomes.map(o => o.outcome),
      outcomeTokenIds: market.tokens?.map(t => t.token_id) ?? [],
      outcomePrices: market.outcomes.map(o => o.price ?? 0),
      volume: market.volume ?? 0,
      volume24hr: market.volume_24hr ?? 0,
      liquidity: market.liquidity ?? 0,
      image: market.image,
      icon: market.icon,
      category: market.category,
      endDateIso: market.end_date_iso,
      active: market.active ?? true,
      closed: market.closed ?? false,
      archived: market.archived ?? false,
      updatedAt: new Date(),
    }));

    await db.insert(markets)
      .values(values)
      .onConflictDoUpdate({
        target: markets.id,
        set: {
          question: sql`excluded.question`,
          description: sql`excluded.description`,
          slug: sql`excluded.slug`,
          outcomes: sql`excluded.outcomes`,
          outcomeTokenIds: sql`excluded.outcome_token_ids`,
          outcomePrices: sql`excluded.outcome_prices`,
          volume: sql`excluded.volume`,
          volume24hr: sql`excluded.volume_24hr`,
          liquidity: sql`excluded.liquidity`,
          image: sql`excluded.image`,
          icon: sql`excluded.icon`,
          category: sql`excluded.category`,
          endDateIso: sql`excluded.end_date_iso`,
          active: sql`excluded.active`,
          closed: sql`excluded.closed`,
          archived: sql`excluded.archived`,
          updatedAt: sql`excluded.updated_at`,
        },
      });

    // Compute search vectors (#10)
    const ids = gammaMarkets.map(m => m.id);
    const idList = sql.join(ids.map(id => sql`${id}`), sql`,`);
    await db.execute(sql`
      UPDATE markets
      SET search_vector = to_tsvector('english', question || ' ' || coalesce(description, ''))
      WHERE id IN (${idList})
    `);
  }

  // ─── Expiration audit ────────────────────────────────────

  /**
   * Run both market and event expiration audits.
   * Called on its own 60s timer and also after each sync completes.
   */
  private async runExpirationAudit(): Promise<void> {
    try {
      await this.auditExpiredMarkets();
      await this.auditExpiredEvents();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error: errorMessage }, 'Expiration audit failed');
    }
  }

  /**
   * Mark markets as inactive when their end date has passed.
   * Only sets `active = false` — does NOT set `closed = true` so we
   * preserve the distinction between "expired" and "officially resolved".
   */
  private async auditExpiredMarkets(): Promise<void> {
    const db = getDb();
    const result = await db.execute(sql`
      UPDATE markets
      SET active = false, updated_at = NOW()
      WHERE active = true
        AND end_date_iso IS NOT NULL
        AND end_date_iso::timestamptz < NOW()
      RETURNING id
    `);

    const count = result.rows?.length ?? result.length ?? 0;
    this.logger.info({ count }, 'Expired markets audit completed');
    if (count > 0) {
      await invalidateCache('neomarket:cache:GET:/markets*');
      await invalidateCache('neomarket:cache:GET:/stats*');
    }
  }

  /**
   * Mark events as inactive when their end date has passed.
   * Only sets `active = false` — does NOT set `closed = true`.
   */
  private async auditExpiredEvents(): Promise<void> {
    const db = getDb();
    const result = await db.execute(sql`
      UPDATE events
      SET active = false, updated_at = NOW()
      WHERE active = true
        AND end_date IS NOT NULL
        AND end_date < NOW()
      RETURNING id
    `);

    const count = result.rows?.length ?? result.length ?? 0;
    this.logger.info({ count }, 'Expired events audit completed');
    if (count > 0) {
      await invalidateCache('neomarket:cache:GET:/events*');
      await invalidateCache('neomarket:cache:GET:/stats*');
    }
  }

  /**
   * Get sync status
   */
  getStatus(): {
    isSyncing: { events: boolean; markets: boolean; trades: boolean };
    lastSyncAt: Date | null;
    error: string | null;
    progress: { markets: number; events: number; trades: number };
  } {
    return {
      isSyncing: {
        events: this.isSyncingEvents,
        markets: this.isSyncingMarkets,
        trades: this.isSyncingTrades,
      },
      lastSyncAt: this.lastSyncAt,
      error: this.syncError,
      progress: this.syncProgress,
    };
  }
}

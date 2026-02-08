/**
 * Batch sync manager - periodic polling of APIs
 * Optimized for high volume: ~26,000 open markets, ~7,000 open events
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
import { and, eq, desc, sql } from 'drizzle-orm';
import { createGammaClient, type GammaMarket, type GammaEvent } from '@app/api/gamma';
import { createDataClient } from '@app/api/data';
import { getDb, markets, events, trades, syncState, type NewMarket, type NewEvent } from '../db';
import { getConfig } from '../lib/config';
import { createChildLogger } from '../lib/logger';
import { invalidateCache } from '../api/middleware/cache';

export class BatchSyncManager {
  private logger = createChildLogger({ module: 'batch-sync' });
  private config = getConfig();
  private gammaClient = createGammaClient({ baseUrl: this.config.gammaApiUrl });
  private dataClient = createDataClient({ baseUrl: this.config.dataApiUrl });
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
   * Run initial sync. Only fetches closed items on a fresh database —
   * on redeploys the closed data from previous syncs is already there
   * and never changes, so we skip the expensive closed pass.
   */
  async runInitialSync(): Promise<void> {
    const db = getDb();
    const [{ count }] = await db.execute(sql`
      SELECT count(*)::int AS count FROM markets WHERE closed = true LIMIT 1
    `) as unknown as [{ count: number }];
    const isFreshDb = count === 0;

    this.logger.info({ isFreshDb }, isFreshDb
      ? 'Fresh database — syncing all items including closed'
      : 'Existing data found — syncing open items only (closed items preserved from previous syncs)');

    // Sync events first (they're parents of markets)
    await this.syncEvents({ includeClosed: isFreshDb });

    // Then sync markets
    await this.syncMarkets({ includeClosed: isFreshDb });

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

      // Open+active markets (token_id -> market_id mapping for filtering global trades feed)
      const activeMarkets = await db.query.markets.findMany({
        where: and(
          eq(markets.active, true),
          eq(markets.closed, false),
          eq(markets.archived, false),
        ),
        columns: { id: true, outcomeTokenIds: true },
      });

      const tokenToMarket = new Map<string, string>();
      for (const market of activeMarkets) {
        const tokenIds = market.outcomeTokenIds as string[];
        for (const tokenId of tokenIds) {
          if (tokenId) tokenToMarket.set(tokenId, market.id);
        }
      }

      // Fetch the global public trades feed once, then filter down to
      // the tokens we care about. This avoids CLOB auth + avoids 1 request per token.
      const feed = await this.dataClient.getPublicTrades(this.config.tradesBatchSize);

      let relevantTrades = 0;
      let insertedTrades = 0;
      const rowsToInsert: Array<typeof trades.$inferInsert> = [];

      for (const trade of feed) {
        const marketId = tokenToMarket.get(trade.asset);
        if (!marketId) continue;
        relevantTrades++;
        this.syncProgress.trades = relevantTrades;

        const ts = new Date(trade.timestamp * 1000);
        const tradeId = createHash('sha256')
          .update([
            String(trade.asset),
            String(trade.side),
            String(trade.price),
            String(trade.size),
            String(trade.timestamp),
            String(trade.transactionHash ?? ''),
            String(trade.proxyWallet ?? ''),
          ].join('|'))
          .digest('hex');

        rowsToInsert.push({
          id: tradeId,
          marketId,
          tokenId: trade.asset,
          side: trade.side,
          price: trade.price,
          size: trade.size,
          timestamp: ts,
          takerOrderId: null,
          transactionHash: trade.transactionHash ?? null,
          feeRateBps: null,
        });
      }

      if (rowsToInsert.length > 0) {
        const inserted = await db.insert(trades)
          .values(rowsToInsert)
          .onConflictDoNothing()
          .returning({ id: trades.id });
        insertedTrades = inserted.length;
      }

      await this.updateSyncState('trades', 'idle', {
        count: insertedTrades,
        feedCount: feed.length,
        relevantCount: relevantTrades,
        marketsTracked: activeMarkets.length,
        durationMs: Date.now() - startTime,
      });

      this.logger.info({
        insertedTrades,
        relevantTrades,
        feedCount: feed.length,
        marketsTracked: activeMarkets.length,
        durationMs: Date.now() - startTime,
      }, 'Trades sync completed');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Log the full error (incl stack) for prod debugging.
      this.logger.error({ error }, 'Trades sync failed');
      await this.updateSyncState('trades', 'error', null, errorMessage);
    } finally {
      this.isSyncingTrades = false;
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
      await this.auditEventsWithNoActiveMarkets();
      await this.auditExpiredEvents();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error: errorMessage }, 'Expiration audit failed');
    }
  }

  /**
   * Mark markets as inactive when their end date has passed.
   * Only targets open (not yet resolved) markets — closed markets
   * are already resolved by Polymarket and should keep their state.
   */
  private async auditExpiredMarkets(): Promise<void> {
    const db = getDb();
    const result = await db.execute(sql`
      UPDATE markets
      SET active = false, updated_at = NOW()
      WHERE active = true
        AND closed = false
        AND end_date_iso IS NOT NULL
        AND end_date_iso::timestamptz < NOW()
      RETURNING id
    `);

    const count = result.length;
    this.logger.info({ count }, 'Expired markets audit completed');
    if (count > 0) {
      await invalidateCache('neomarket:cache:GET:/markets*');
      await invalidateCache('neomarket:cache:GET:/stats*');
    }
  }

  /**
   * Mark events as inactive when their end date has passed.
   * Only targets open (not yet resolved) events.
   */
  private async auditExpiredEvents(): Promise<void> {
    const db = getDb();
    const result = await db.execute(sql`
      UPDATE events
      SET active = false, updated_at = NOW()
      WHERE active = true
        AND closed = false
        AND end_date IS NOT NULL
        AND end_date < NOW()
      RETURNING id
    `);

    const count = result.length;
    this.logger.info({ count }, 'Expired events audit completed');
    if (count > 0) {
      await invalidateCache('neomarket:cache:GET:/events*');
      await invalidateCache('neomarket:cache:GET:/stats*');
    }
  }

  /**
   * Deactivate open events when none of their linked markets remain active.
   * Does not touch events with no linked markets.
   */
  private async auditEventsWithNoActiveMarkets(): Promise<void> {
    const db = getDb();
    const result = await db.execute(sql`
      UPDATE events
      SET active = false, updated_at = NOW()
      WHERE active = true
        AND closed = false
        AND id IN (
          SELECT e.id FROM events e
          JOIN markets m ON m.event_id = e.id
          WHERE e.active = true AND e.closed = false
          GROUP BY e.id
          HAVING COUNT(*) FILTER (WHERE m.active = true) = 0
        )
      RETURNING id
    `);

    const count = result.length;
    this.logger.info({ count }, 'Events with no active markets audit completed');
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

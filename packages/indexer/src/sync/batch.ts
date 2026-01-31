/**
 * Batch sync manager - periodic polling of APIs
 * Optimized for high volume: ~26,000 markets, ~7,000 events
 */

import { eq, sql } from 'drizzle-orm';
import { createGammaClient, type GammaMarket, type GammaEvent, type GammaMarketRaw } from '@app/api/gamma';
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
  private isSyncing = false;
  private lastSyncAt: Date | null = null;
  private syncError: string | null = null;
  private syncProgress = { markets: 0, events: 0 };

  /**
   * Run initial full sync of all data
   */
  async runInitialSync(): Promise<void> {
    this.logger.info('Starting initial sync (expect ~26k markets, ~7k events)');

    // Sync events first (they're parents of markets)
    await this.syncEvents();

    // Then sync markets
    await this.syncMarkets();

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

    this.logger.info({
      marketsSyncInterval: this.config.marketsSyncInterval,
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

  /**
   * Sync events from Gamma API
   */
  async syncEvents(): Promise<void> {
    if (this.isSyncing) {
      this.logger.warn('Sync already in progress, skipping events sync');
      return;
    }

    this.isSyncing = true;
    this.syncError = null;
    this.syncProgress.events = 0;

    const db = getDb();
    const startTime = Date.now();
    const FETCH_BATCH_SIZE = 500;

    try {
      await this.updateSyncState('events', 'syncing');

      this.logger.info('Syncing events from Gamma API');

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

          // Upsert immediately
          await this.upsertEvents(batch);

          offset += batch.length;
          totalEvents += batch.length;
          this.syncProgress.events = totalEvents;

          // Log progress every 1000 events
          if (totalEvents % 1000 === 0 || batch.length < FETCH_BATCH_SIZE) {
            this.logger.info({ synced: totalEvents }, 'Events sync progress');
          }

          if (batch.length < FETCH_BATCH_SIZE) break;

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      };

      // Fetch open and closed events to keep totals accurate
      await fetchByFilter({ closed: false });
      await fetchByFilter({ closed: true });

      await this.updateSyncState('events', 'idle', { count: totalEvents, durationMs: Date.now() - startTime });

      // Invalidate cache after successful sync
      await invalidateCache('neomarket:cache:*');

      this.logger.info({
        totalEvents,
        durationMs: Date.now() - startTime,
      }, 'Events sync completed');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.syncError = errorMessage;
      this.logger.error({ error: errorMessage }, 'Events sync failed');
      await this.updateSyncState('events', 'error', null, errorMessage);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Sync markets from Gamma API
   */
  async syncMarkets(): Promise<void> {
    if (this.isSyncing) {
      this.logger.warn('Sync already in progress, skipping markets sync');
      return;
    }

    this.isSyncing = true;
    this.syncError = null;
    this.syncProgress.markets = 0;

    const db = getDb();
    const startTime = Date.now();
    const FETCH_BATCH_SIZE = 500;

    try {
      await this.updateSyncState('markets', 'syncing');

      this.logger.info('Syncing markets from Gamma API');

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

          // Upsert immediately to avoid memory buildup
          await this.upsertMarkets(batch);

          offset += batch.length;
          totalMarkets += batch.length;
          this.syncProgress.markets = totalMarkets;

          // Log progress every 2000 markets
          if (totalMarkets % 2000 === 0 || batch.length < FETCH_BATCH_SIZE) {
            this.logger.info({ synced: totalMarkets }, 'Markets sync progress');
          }

          if (batch.length < FETCH_BATCH_SIZE) break;

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      };

      // Fetch open and closed markets for full dataset
      await fetchByFilter({ closed: false });
      await fetchByFilter({ closed: true });

      await this.updateSyncState('markets', 'idle', { count: totalMarkets, durationMs: Date.now() - startTime });

      // Invalidate cache after successful sync
      await invalidateCache('neomarket:cache:*');

      this.lastSyncAt = new Date();
      this.logger.info({
        totalMarkets,
        durationMs: Date.now() - startTime,
      }, 'Markets sync completed');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.syncError = errorMessage;
      this.logger.error({ error: errorMessage }, 'Markets sync failed');
      await this.updateSyncState('markets', 'error', null, errorMessage);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Update sync state in database
   */
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
   * Upsert events into database (also extracts and links nested markets)
   */
  private async upsertEvents(gammaEvents: GammaEvent[]): Promise<void> {
    const db = getDb();

    for (const event of gammaEvents) {
      const newEvent: NewEvent = {
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
      };

      await db.insert(events)
        .values(newEvent)
        .onConflictDoUpdate({
          target: events.id,
          set: {
            title: newEvent.title,
            slug: newEvent.slug,
            description: newEvent.description,
            image: newEvent.image,
            icon: newEvent.icon,
            endDate: newEvent.endDate,
            volume: newEvent.volume,
            volume24hr: newEvent.volume24hr,
            liquidity: newEvent.liquidity,
            active: newEvent.active,
            closed: newEvent.closed,
            archived: newEvent.archived,
            updatedAt: new Date(),
          },
        });

      // Also upsert nested markets with event_id linkage
      if (event.markets && event.markets.length > 0) {
        for (const rawMarket of event.markets) {
          await this.upsertMarketFromEvent(rawMarket, event.id);
        }
      }
    }
  }

  /**
   * Upsert a single market from an event (with event_id linkage)
   */
  private async upsertMarketFromEvent(rawMarket: GammaMarketRaw, eventId: string): Promise<void> {
    const db = getDb();

    // Parse JSON strings safely
    let outcomeNames: string[] = [];
    let outcomePrices: number[] = [];
    let tokenIds: string[] = [];

    try {
      outcomeNames = JSON.parse(rawMarket.outcomes);
    } catch {
      outcomeNames = ['Yes', 'No'];
    }

    try {
      if (rawMarket.outcomePrices) {
        const prices = JSON.parse(rawMarket.outcomePrices);
        outcomePrices = prices.map((p: string) => parseFloat(p) || 0);
      }
    } catch {
      outcomePrices = [];
    }

    try {
      if (rawMarket.clobTokenIds) {
        tokenIds = JSON.parse(rawMarket.clobTokenIds);
      }
    } catch {
      tokenIds = [];
    }

    const newMarket: NewMarket = {
      id: rawMarket.id,
      eventId, // Link to parent event
      conditionId: rawMarket.conditionId,
      question: rawMarket.question,
      description: rawMarket.description ?? undefined,
      slug: rawMarket.slug ?? undefined,
      outcomes: outcomeNames,
      outcomeTokenIds: tokenIds,
      outcomePrices: outcomePrices,
      volume: rawMarket.volumeNum ?? 0,
      volume24hr: rawMarket.volume24hr ?? 0,
      liquidity: rawMarket.liquidityNum ?? 0,
      image: rawMarket.image ?? undefined,
      icon: rawMarket.icon ?? undefined,
      category: rawMarket.category ?? undefined,
      endDateIso: rawMarket.endDateIso ?? undefined,
      active: rawMarket.active ?? true,
      closed: rawMarket.closed ?? false,
      archived: rawMarket.archived ?? false,
      updatedAt: new Date(),
    };

    await db.insert(markets)
      .values(newMarket)
      .onConflictDoUpdate({
        target: markets.id,
        set: {
          eventId: newMarket.eventId,
          question: newMarket.question,
          description: newMarket.description,
          slug: newMarket.slug,
          outcomes: newMarket.outcomes,
          outcomeTokenIds: newMarket.outcomeTokenIds,
          outcomePrices: newMarket.outcomePrices,
          volume: newMarket.volume,
          volume24hr: newMarket.volume24hr,
          liquidity: newMarket.liquidity,
          image: newMarket.image,
          icon: newMarket.icon,
          category: newMarket.category,
          endDateIso: newMarket.endDateIso,
          active: newMarket.active,
          closed: newMarket.closed,
          archived: newMarket.archived,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Upsert markets into database
   */
  private async upsertMarkets(gammaMarkets: GammaMarket[]): Promise<void> {
    const db = getDb();

    for (const market of gammaMarkets) {
      const newMarket: NewMarket = {
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
      };

      await db.insert(markets)
        .values(newMarket)
        .onConflictDoUpdate({
          target: markets.id,
          set: {
            question: newMarket.question,
            description: newMarket.description,
            slug: newMarket.slug,
            outcomes: newMarket.outcomes,
            outcomeTokenIds: newMarket.outcomeTokenIds,
            outcomePrices: newMarket.outcomePrices,
            volume: newMarket.volume,
            volume24hr: newMarket.volume24hr,
            liquidity: newMarket.liquidity,
            image: newMarket.image,
            icon: newMarket.icon,
            category: newMarket.category,
            endDateIso: newMarket.endDateIso,
            active: newMarket.active,
            closed: newMarket.closed,
            archived: newMarket.archived,
            updatedAt: new Date(),
          },
        });
    }
  }

  /**
   * Sync trades from CLOB API for a specific market
   * Returns result so callers can detect failure without crashing the sync loop
   */
  async syncTrades(tokenId: string, marketId: string): Promise<{ success: boolean; count: number }> {
    const db = getDb();

    try {
      const trades = await this.clobClient.getTrades(tokenId, this.config.tradesBatchSize);

      for (const trade of trades) {
        await db.execute(sql`
          INSERT INTO trades (id, market_id, token_id, side, price, size, timestamp, taker_order_id, transaction_hash, fee_rate_bps)
          VALUES (
            ${trade.id ?? `${trade.asset_id}-${trade.timestamp}`},
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

  /**
   * Get sync status
   */
  getStatus(): {
    isSyncing: boolean;
    lastSyncAt: Date | null;
    error: string | null;
    progress: { markets: number; events: number };
  } {
    return {
      isSyncing: this.isSyncing,
      lastSyncAt: this.lastSyncAt,
      error: this.syncError,
      progress: this.syncProgress,
    };
  }
}

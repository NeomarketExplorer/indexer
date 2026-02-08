/**
 * Real-time sync manager - WebSocket price updates
 *
 * Fixes applied:
 * - #6  Buffer snapshot: clear only after successful flush
 * - #7  Do not overwrite lastTradePrice from WS updates
 * - #9  Never permanently give up reconnecting
 */

import { and, eq } from 'drizzle-orm';
import { getDb, markets, priceHistory, syncState } from '../db';
import { getConfig } from '../lib/config';
import { createChildLogger } from '../lib/logger';
import WebSocket from 'ws';

interface PriceUpdate {
  tokenId: string;
  marketId: string;
  price: number;
  timestamp: Date;
}

interface WebSocketMessage {
  // Market-channel messages come in a few shapes:
  // - Orderbook snapshots: JSON array of { asset_id, bids, asks, timestamp, ... }
  // - Price changes: { market, price_changes: [{ asset_id, price, best_bid, best_ask, ... }, ...] }
  // Keep this permissive; parsing happens in handleMessage().
  [key: string]: unknown;
}

const BUFFER_SIZE_WARNING = 10000;

export class RealtimeSyncManager {
  private logger = createChildLogger({ module: 'realtime-sync' });
  private config = getConfig();
  private ws: WebSocket | null = null;
  private isConnected = false;
  private isConnecting = false;
  private isFlushingPrices = false;
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private priceBuffer: Map<string, PriceUpdate> = new Map();
  private flushInterval: NodeJS.Timeout | null = null;
  private subscribedTokens: Set<string> = new Set();
  private tokenToMarket: Map<string, string> = new Map();

  /**
   * Start real-time sync
   */
  async start(): Promise<void> {
    this.logger.info('Starting real-time sync');

    await this.loadActiveTokens();
    await this.connect();
    this.startFlushInterval();
  }

  /**
   * Stop real-time sync
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping real-time sync');
    this.shouldReconnect = false;

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    await this.flushPrices();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
  }

  /**
   * Load active market tokens from database
   */
  private async loadActiveTokens(): Promise<void> {
    const db = getDb();

    const activeMarkets = await db.query.markets.findMany({
      // Only subscribe to truly-live markets; "active=true" alone is too broad
      // (Gamma can leave active=true for closed/archived items).
      where: and(
        eq(markets.active, true),
        eq(markets.closed, false),
        eq(markets.archived, false),
      ),
      columns: {
        id: true,
        outcomeTokenIds: true,
      },
    });

    this.tokenToMarket.clear();
    this.subscribedTokens.clear();

    for (const market of activeMarkets) {
      const tokenIds = market.outcomeTokenIds as string[];
      for (const tokenId of tokenIds) {
        if (tokenId) {
          this.tokenToMarket.set(tokenId, market.id);
          this.subscribedTokens.add(tokenId);
        }
      }
    }

    this.logger.info({ tokenCount: this.subscribedTokens.size }, 'Loaded active tokens');
  }

  /**
   * Connect to WebSocket server
   */
  private connect(): Promise<void> {
    if (this.isConnecting || this.isConnected) {
      return Promise.resolve();
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      this.logger.info({ url: this.config.wsUrl }, 'Connecting to WebSocket');

      this.ws = new WebSocket(this.config.wsUrl);

      this.ws.on('open', () => {
        this.isConnecting = false;
        this.isConnected = true;
        this.reconnectAttempts = 0;

        this.logger.info('WebSocket connected');

        this.subscribeToTokens();
        this.updatePricesSyncState('connected');
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        this.isConnecting = false;
        this.isConnected = false;
        this.logger.warn('WebSocket disconnected');
        this.updatePricesSyncState('disconnected');

        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (error) => {
        this.isConnecting = false;
        this.logger.error({ error }, 'WebSocket error');

        if (!this.isConnected) {
          reject(error);
        }
      });
    });
  }

  /**
   * Subscribe to price updates for all active tokens
   */
  private subscribeToTokens(): void {
    if (!this.ws || this.subscribedTokens.size === 0) {
      return;
    }

    const tokenIds = Array.from(this.subscribedTokens);

    const batchSize = 100;
    const firstBatch = tokenIds.slice(0, batchSize);
    // The market channel requires the *first* message to be the initial shape:
    // { type: "market", assets_ids: [...] }. Additional messages must use
    // operation=subscribe.
    this.ws.send(JSON.stringify({ type: 'market', assets_ids: firstBatch }));

    for (let i = batchSize; i < tokenIds.length; i += batchSize) {
      const batch = tokenIds.slice(i, i + batchSize);
      this.ws.send(JSON.stringify({ operation: 'subscribe', assets_ids: batch }));
    }

    this.logger.info({ tokenCount: tokenIds.length }, 'Subscribed to price updates');
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      // Server-side protocol errors come back as plaintext.
      if (data === 'INVALID OPERATION') {
        return;
      }

      const parsed = JSON.parse(data) as WebSocketMessage | unknown[];

      // Orderbook snapshot: array of entries, each for a tokenId.
      // We currently ignore these (they are large); price updates come via price_changes.
      if (Array.isArray(parsed)) {
        return;
      }

      const message = parsed as WebSocketMessage;
      const priceChanges = (message as { price_changes?: unknown }).price_changes;

      if (!Array.isArray(priceChanges)) {
        return;
      }

      const now = new Date();

      for (const change of priceChanges as Array<Record<string, unknown>>) {
        const tokenId = typeof change.asset_id === 'string' ? change.asset_id : null;
        const priceRaw = change.price;
        const price = typeof priceRaw === 'string' ? parseFloat(priceRaw) : typeof priceRaw === 'number' ? priceRaw : NaN;

        if (!tokenId || isNaN(price)) continue;

        const marketId = this.tokenToMarket.get(tokenId);
        if (!marketId) continue;

        this.priceBuffer.set(tokenId, {
          tokenId,
          marketId,
          price,
          timestamp: now,
        });
      }
    } catch (error) {
      this.logger.warn({ data, error }, 'Failed to parse WebSocket message');
    }
  }

  /**
   * Start the price flush interval
   */
  private startFlushInterval(): void {
    this.flushInterval = setInterval(
      () => this.flushPrices(),
      this.config.priceFlushInterval
    );
  }

  /**
   * Flush buffered prices to database.
   * (#6) Takes a snapshot first; clears only on success so failures retain data.
   */
  private async flushPrices(): Promise<void> {
    if (this.isFlushingPrices) {
      this.logger.debug('Price flush already in progress, skipping');
      return;
    }

    if (this.priceBuffer.size === 0) {
      return;
    }

    this.isFlushingPrices = true;

    // Soft cap warning
    if (this.priceBuffer.size > BUFFER_SIZE_WARNING) {
      this.logger.warn({ size: this.priceBuffer.size }, 'Price buffer growing large');
    }

    const db = getDb();
    // Snapshot current entries
    const snapshot = new Map(this.priceBuffer);
    const updates = Array.from(snapshot.values());

    const startTime = Date.now();

    try {
      // Group updates by market for batch processing
      const marketUpdates = new Map<string, PriceUpdate[]>();
      for (const update of updates) {
        const existing = marketUpdates.get(update.marketId) ?? [];
        existing.push(update);
        marketUpdates.set(update.marketId, existing);
      }

      for (const [marketId, priceUpdates] of marketUpdates) {
        const market = await db.query.markets.findFirst({
          where: eq(markets.id, marketId),
          columns: {
            outcomeTokenIds: true,
            outcomePrices: true,
          },
        });

        if (!market) continue;

        const tokenIds = market.outcomeTokenIds as string[];
        const newPrices = [...(market.outcomePrices as number[])];

        for (const update of priceUpdates) {
          const tokenIndex = tokenIds.indexOf(update.tokenId);
          if (tokenIndex !== -1) {
            newPrices[tokenIndex] = update.price;
          }

          // Insert price history
          await db.insert(priceHistory)
            .values({
              marketId: update.marketId,
              tokenId: update.tokenId,
              timestamp: update.timestamp,
              price: update.price,
              source: 'websocket',
            })
            .onConflictDoNothing({
              target: [priceHistory.marketId, priceHistory.tokenId, priceHistory.timestamp, priceHistory.source],
            });
        }

        // (#7) Update outcomePrices only — do NOT overwrite lastTradePrice.
        // WS "last_trade_price" channel gives per-token prices, not a
        // market-level last-trade value. lastTradePrice should only be set
        // from verified trade records.
        await db.update(markets)
          .set({
            outcomePrices: newPrices,
            priceUpdatedAt: new Date(),
          })
          .where(eq(markets.id, marketId));
      }

      // Clear only the entries we successfully flushed (#6)
      for (const key of snapshot.keys()) {
        this.priceBuffer.delete(key);
      }

      this.logger.debug({
        updateCount: updates.length,
        marketCount: marketUpdates.size,
        durationMs: Date.now() - startTime,
      }, 'Flushed price updates');

    } catch (error) {
      this.logger.error({ error }, 'Failed to flush prices, will retry next interval');
      // Buffer is intentionally preserved for retry
    } finally {
      this.isFlushingPrices = false;
    }
  }

  /**
   * (#9) Schedule a reconnection attempt.
   * After max fast-backoff attempts, keeps retrying at a slower 60s interval
   * instead of giving up permanently.
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const isPastMax = this.reconnectAttempts > this.config.wsMaxReconnectAttempts;

    // Fast exponential backoff up to max, then slow fixed interval
    const delay = isPastMax
      ? 60_000
      : Math.min(this.config.wsReconnectInterval * Math.pow(2, this.reconnectAttempts - 1), 30_000);

    if (isPastMax) {
      // Log periodically, not every attempt
      if (this.reconnectAttempts % 10 === 0) {
        this.logger.error({ attempt: this.reconnectAttempts }, 'WebSocket still reconnecting at slow interval');
      }
    } else {
      this.logger.info({ attempt: this.reconnectAttempts, delay }, 'Scheduling reconnect');
    }

    setTimeout(async () => {
      if (this.shouldReconnect && !this.isConnected) {
        try {
          await this.connect();
        } catch (error) {
          this.logger.error({ error }, 'Reconnection failed');
          // The 'close' handler will call scheduleReconnect again
        }
      }
    }, delay);
  }

  /**
   * Resubscribe to all tokens (after market sync adds new markets)
   */
  async resubscribe(): Promise<void> {
    await this.loadActiveTokens();

    // If connected, add tokens via operation=subscribe (market channel).
    // If not, subscribeToTokens() will run on connect().
    if (this.ws && this.isConnected && this.subscribedTokens.size > 0) {
      const tokenIds = Array.from(this.subscribedTokens);
      const batchSize = 100;
      for (let i = 0; i < tokenIds.length; i += batchSize) {
        const batch = tokenIds.slice(i, i + batchSize);
        this.ws.send(JSON.stringify({ operation: 'subscribe', type: 'market', assets_ids: batch }));
      }
      this.logger.info({ tokenCount: tokenIds.length }, 'Resubscribed to market channel tokens');
      return;
    }

    this.subscribeToTokens();
  }

  /**
   * Persist WS connection status into sync_state for health checks
   */
  private updatePricesSyncState(status: string): void {
    const db = getDb();
    db.insert(syncState)
      .values({
        entity: 'prices',
        status,
        lastSyncAt: new Date(),
      })
      .onConflictDoUpdate({
        target: syncState.entity,
        set: {
          status,
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .catch(err => this.logger.debug({ err }, 'Failed to update prices sync state'));
  }

  /**
   * Get status
   */
  getStatus(): {
    isConnected: boolean;
    subscribedTokens: number;
    bufferedUpdates: number;
    reconnectAttempts: number;
  } {
    return {
      isConnected: this.isConnected,
      subscribedTokens: this.subscribedTokens.size,
      bufferedUpdates: this.priceBuffer.size,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

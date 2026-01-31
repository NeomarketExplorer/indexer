/**
 * Real-time sync manager - WebSocket price updates
 */

import { eq, sql } from 'drizzle-orm';
import { getDb, markets, priceHistory } from '../db';
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
  type?: string;
  asset_id?: string;
  market?: string;
  price?: string | number;
  timestamp?: number;
}

export class RealtimeSyncManager {
  private logger = createChildLogger({ module: 'realtime-sync' });
  private config = getConfig();
  private ws: WebSocket | null = null;
  private isConnected = false;
  private isConnecting = false;
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

    // Load active tokens from database
    await this.loadActiveTokens();

    // Connect to WebSocket
    await this.connect();

    // Start price flush interval
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

    // Flush remaining prices
    await this.flushPrices();

    // Close WebSocket
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
      where: eq(markets.active, true),
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

        // Subscribe to price updates for all tokens
        this.subscribeToTokens();
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        this.isConnecting = false;
        this.isConnected = false;
        this.logger.warn('WebSocket disconnected');

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

    // Subscribe in batches to avoid message size limits
    const batchSize = 100;
    for (let i = 0; i < tokenIds.length; i += batchSize) {
      const batch = tokenIds.slice(i, i + batchSize);

      const subscription = {
        action: 'subscribe',
        type: 'last_trade_price',
        assets_ids: batch,
      };

      this.ws.send(JSON.stringify(subscription));
    }

    this.logger.info({ tokenCount: tokenIds.length }, 'Subscribed to price updates');
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as WebSocketMessage;

      // Handle last_trade_price updates
      if (message.asset_id && message.price !== undefined) {
        const tokenId = message.asset_id;
        const marketId = this.tokenToMarket.get(tokenId);

        if (marketId) {
          const price = typeof message.price === 'string'
            ? parseFloat(message.price)
            : message.price;

          if (!isNaN(price)) {
            this.priceBuffer.set(tokenId, {
              tokenId,
              marketId,
              price,
              timestamp: new Date(message.timestamp ?? Date.now()),
            });
          }
        }
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
   * Flush buffered prices to database
   */
  private async flushPrices(): Promise<void> {
    if (this.priceBuffer.size === 0) {
      return;
    }

    const db = getDb();
    const updates = Array.from(this.priceBuffer.values());
    this.priceBuffer.clear();

    const startTime = Date.now();

    try {
      // Group updates by market for batch processing
      const marketUpdates = new Map<string, PriceUpdate[]>();
      for (const update of updates) {
        const existing = marketUpdates.get(update.marketId) ?? [];
        existing.push(update);
        marketUpdates.set(update.marketId, existing);
      }

      // Update market prices and insert price history
      for (const [marketId, priceUpdates] of marketUpdates) {
        // Get current market data
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

        // Update prices for each token
        for (const update of priceUpdates) {
          const tokenIndex = tokenIds.indexOf(update.tokenId);
          if (tokenIndex !== -1) {
            newPrices[tokenIndex] = update.price;
          }

          // Insert price history
          await db.insert(priceHistory).values({
            marketId: update.marketId,
            tokenId: update.tokenId,
            timestamp: update.timestamp,
            price: update.price,
            source: 'websocket',
          });
        }

        // Calculate last trade price (use first outcome price)
        const lastTradePrice = newPrices[0] ?? null;

        // Update market
        await db.update(markets)
          .set({
            outcomePrices: newPrices,
            lastTradePrice,
            priceUpdatedAt: new Date(),
          })
          .where(eq(markets.id, marketId));
      }

      this.logger.debug({
        updateCount: updates.length,
        marketCount: marketUpdates.size,
        durationMs: Date.now() - startTime,
      }, 'Flushed price updates');

    } catch (error) {
      this.logger.error({ error }, 'Failed to flush prices');
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.wsMaxReconnectAttempts) {
      this.logger.error('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.config.wsReconnectInterval * Math.pow(2, this.reconnectAttempts - 1),
      30000
    );

    this.logger.info({ attempt: this.reconnectAttempts, delay }, 'Scheduling reconnect');

    setTimeout(async () => {
      if (this.shouldReconnect && !this.isConnected) {
        try {
          await this.connect();
        } catch (error) {
          this.logger.error({ error }, 'Reconnection failed');
        }
      }
    }, delay);
  }

  /**
   * Resubscribe to all tokens (after market sync)
   */
  async resubscribe(): Promise<void> {
    await this.loadActiveTokens();
    this.subscribeToTokens();
  }

  /**
   * Get status
   */
  getStatus(): {
    isConnected: boolean;
    subscribedTokens: number;
    bufferedUpdates: number;
  } {
    return {
      isConnected: this.isConnected,
      subscribedTokens: this.subscribedTokens.size,
      bufferedUpdates: this.priceBuffer.size,
    };
  }
}

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

type WsClient = {
  id: number;
  ws: WebSocket | null;
  isConnected: boolean;
  isConnecting: boolean;
  reconnectAttempts: number;
  // Tokens currently assigned to this client (sharding).
  assignedTokens: string[];
  // Tokens we believe we've already subscribed to on this connection.
  subscribedTokens: Set<string>;
};

export class RealtimeSyncManager {
  private logger = createChildLogger({ module: 'realtime-sync' });
  private config = getConfig();
  private isFlushingPrices = false;
  private shouldReconnect = true;
  private priceBuffer: Map<string, PriceUpdate> = new Map();
  private flushInterval: NodeJS.Timeout | null = null;
  private subscribedTokens: Set<string> = new Set();
  private tokenToMarket: Map<string, string> = new Map();
  private clients: WsClient[] = [];
  private lastPublishedPricesStatus: 'connected' | 'disconnected' | null = null;

  /**
   * Start real-time sync
   */
  async start(): Promise<void> {
    this.logger.info('Starting real-time sync');

    await this.loadActiveTokens();
    this.initClients();
    this.assignTokenShards();
    await this.connectAll();
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

    for (const c of this.clients) {
      if (c.ws) {
        c.ws.close();
        c.ws = null;
      }
      c.isConnected = false;
      c.isConnecting = false;
      c.reconnectAttempts = 0;
      c.subscribedTokens.clear();
    }
    this.publishPricesStatus();
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
   * Initialize WS clients (one per desired connection).
   */
  private initClients(): void {
    const count = Math.max(1, this.config.wsConnections);
    if (this.clients.length === count) return;

    this.clients = Array.from({ length: count }, (_, i): WsClient => ({
      id: i,
      ws: null,
      isConnected: false,
      isConnecting: false,
      reconnectAttempts: 0,
      assignedTokens: [],
      subscribedTokens: new Set<string>(),
    }));

    this.logger.info({ wsConnections: count }, 'Initialized WebSocket clients');
  }

  /**
   * Stable sharding of token_ids across WS connections.
   * We use a cheap string hash to keep assignment stable across restarts.
   */
  private assignTokenShards(): void {
    for (const c of this.clients) {
      c.assignedTokens = [];
    }

    const tokenIds = Array.from(this.subscribedTokens);
    const n = this.clients.length;

    for (const tokenId of tokenIds) {
      const idx = this.hashToken(tokenId) % n;
      this.clients[idx]!.assignedTokens.push(tokenId);
    }

    this.logger.info({
      wsConnections: n,
      tokenCount: tokenIds.length,
      shardSizes: this.clients.map(c => c.assignedTokens.length),
    }, 'Assigned token shards');
  }

  private hashToken(tokenId: string): number {
    // FNV-1a 32-bit
    let h = 0x811c9dc5;
    for (let i = 0; i < tokenId.length; i++) {
      h ^= tokenId.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /**
   * Connect all WS clients (best-effort; doesn't fail the whole manager).
   */
  private async connectAll(): Promise<void> {
    const results = await Promise.allSettled(
      this.clients.map(c => this.connectClient(c))
    );
    const rejected = results.filter(r => r.status === 'rejected');
    if (rejected.length > 0) {
      this.logger.warn({ rejected: rejected.length }, 'Some WebSocket connections failed to start');
    }
  }

  /**
   * Connect a single WebSocket client
   */
  private connectClient(client: WsClient): Promise<void> {
    if (client.isConnecting || client.isConnected) {
      return Promise.resolve();
    }

    client.isConnecting = true;

    return new Promise((resolve, reject) => {
      this.logger.info({ url: this.config.wsUrl, clientId: client.id }, 'Connecting to WebSocket');

      client.ws = new WebSocket(this.config.wsUrl);

      client.ws.on('open', () => {
        client.isConnecting = false;
        client.isConnected = true;
        client.reconnectAttempts = 0;
        client.subscribedTokens.clear();

        this.logger.info({ clientId: client.id }, 'WebSocket connected');

        this.subscribeClientTokens(client, { initial: true });
        this.publishPricesStatus();
        resolve();
      });

      client.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      client.ws.on('close', () => {
        client.isConnecting = false;
        client.isConnected = false;
        this.logger.warn({ clientId: client.id }, 'WebSocket disconnected');
        this.publishPricesStatus();

        if (this.shouldReconnect) {
          this.scheduleReconnect(client);
        }
      });

      client.ws.on('error', (error) => {
        client.isConnecting = false;
        this.logger.error({ error, clientId: client.id }, 'WebSocket error');

        if (!client.isConnected) {
          reject(error);
        }
      });
    });
  }

  /**
   * Subscribe assigned tokens for a single WS client.
   */
  private subscribeClientTokens(client: WsClient, opts: { initial: boolean }): void {
    if (!client.ws || client.ws.readyState !== WebSocket.OPEN || client.assignedTokens.length === 0) {
      return;
    }

    const tokenIds = client.assignedTokens;
    this.sendSubscriptions(client.ws, tokenIds, opts);
    // We treat the whole shard as subscribed after send; server-side behavior is best-effort.
    for (const t of tokenIds) client.subscribedTokens.add(t);
  }

  /**
   * Send market-channel subscriptions in paced batches.
   * We avoid blasting hundreds of WS frames in a tight loop, which can trigger
   * server-side disconnects.
   */
  private sendSubscriptions(ws: WebSocket, tokenIds: string[], opts: { initial: boolean }): void {
    if (ws.readyState !== WebSocket.OPEN || tokenIds.length === 0) {
      return;
    }

    // Tuned for stability: fewer frames, slight pacing.
    const batchSize = 500;
    const batchDelayMs = 25;

    const batches: string[][] = [];
    for (let i = 0; i < tokenIds.length; i += batchSize) {
      batches.push(tokenIds.slice(i, i + batchSize));
    }

    const send = (payload: unknown) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(payload));
    };

    let i = 0;
    if (opts.initial) {
      // The market channel requires the *first* message to be the initial shape:
      // { type: "market", assets_ids: [...] }. Additional messages must use
      // operation=subscribe.
      send({ type: 'market', assets_ids: batches[0] });
      i = 1;
    }

    const sendNext = () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (i >= batches.length) return;
      // Include type on subscribe payloads as well; the server can emit plaintext
      // errors (eg "NO NEW ASSETS") and disconnect when the shape is not accepted.
      send({ type: 'market', operation: 'subscribe', assets_ids: batches[i] });
      i++;
      setTimeout(sendNext, batchDelayMs);
    };

    if (i < batches.length) {
      setTimeout(sendNext, batchDelayMs);
    }

    this.logger.info({
      tokenCount: tokenIds.length,
      batchSize,
      batches: batches.length,
      initial: opts.initial,
    }, 'Sent market-channel subscriptions');
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      // Server-side protocol errors come back as plaintext.
      if (data === 'INVALID OPERATION' || data === 'NO NEW ASSETS') {
        return;
      }

      // Ignore other plaintext messages (e.g. keepalives / status strings).
      const firstChar = data[0];
      if (firstChar !== '{' && firstChar !== '[') {
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
  private scheduleReconnect(client: WsClient): void {
    client.reconnectAttempts++;
    const isPastMax = client.reconnectAttempts > this.config.wsMaxReconnectAttempts;

    // Fast exponential backoff up to max, then slow fixed interval
    const delay = isPastMax
      ? 60_000
      : Math.min(this.config.wsReconnectInterval * Math.pow(2, client.reconnectAttempts - 1), 30_000);

    if (isPastMax) {
      // Log periodically, not every attempt
      if (client.reconnectAttempts % 10 === 0) {
        this.logger.error({ attempt: client.reconnectAttempts, clientId: client.id }, 'WebSocket still reconnecting at slow interval');
      }
    } else {
      this.logger.info({ attempt: client.reconnectAttempts, delay, clientId: client.id }, 'Scheduling reconnect');
    }

    setTimeout(async () => {
      if (this.shouldReconnect && !client.isConnected) {
        try {
          await this.connectClient(client);
        } catch (error) {
          this.logger.error({ error, clientId: client.id }, 'Reconnection failed');
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
    this.initClients();
    this.assignTokenShards();

    // If connected, add tokens via operation=subscribe (market channel).
    // If not, subscribeToTokens() will run on connect().
    for (const c of this.clients) {
      if (!c.ws || !c.isConnected) continue;
      const next = c.assignedTokens;
      const toAdd = next.filter(t => !c.subscribedTokens.has(t));
      if (toAdd.length === 0) continue;
      this.sendSubscriptions(c.ws, toAdd, { initial: false });
      for (const t of toAdd) c.subscribedTokens.add(t);
    }
  }

  /**
   * Persist WS connection status into sync_state for health checks
   */
  private updatePricesSyncState(status: 'connected' | 'disconnected'): void {
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

  private publishPricesStatus(): void {
    const anyConnected = this.clients.some(c => c.isConnected);
    const status: 'connected' | 'disconnected' = anyConnected ? 'connected' : 'disconnected';
    if (this.lastPublishedPricesStatus === status) return;
    this.lastPublishedPricesStatus = status;
    this.updatePricesSyncState(status);
  }

  /**
   * Get status
   */
  getStatus(): {
    isConnected: boolean;
    subscribedTokens: number;
    bufferedUpdates: number;
    reconnectAttempts: number;
    connections: number;
    connectedConnections: number;
  } {
    const connectedConnections = this.clients.filter(c => c.isConnected).length;
    const reconnectAttempts = this.clients.reduce((max, c) => Math.max(max, c.reconnectAttempts), 0);
    return {
      isConnected: connectedConnections > 0,
      subscribedTokens: this.subscribedTokens.size,
      bufferedUpdates: this.priceBuffer.size,
      reconnectAttempts,
      connections: this.clients.length || 1,
      connectedConnections,
    };
  }
}

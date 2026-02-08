/**
 * CLOB API client - Trading operations
 * https://clob.polymarket.com
 */

import { z } from 'zod';
import { ApiClient, createApiClient, type ApiClientConfig } from '../client';
export { buildPolyHmacSignature, createPolymarketL2Auth, type PolymarketL2Credentials } from './auth';

// CLOB API Schemas
export const OrderbookLevelSchema = z.object({
  price: z.string(),
  size: z.string(),
});

export const OrderbookSchema = z.object({
  market: z.string(),
  asset_id: z.string(),
  hash: z.string().optional(),
  timestamp: z.string().optional(),
  bids: z.array(OrderbookLevelSchema),
  asks: z.array(OrderbookLevelSchema),
});

export const TradeSchema = z.object({
  id: z.string().optional(),
  taker_order_id: z.string().optional(),
  market: z.string().optional(),
  asset_id: z.string(),
  side: z.enum(['BUY', 'SELL']),
  price: z.string(),
  size: z.string(),
  fee_rate_bps: z.string().optional(),
  timestamp: z.string().optional(),
  // Newer CLOB trade objects use match_time/last_update instead of timestamp.
  match_time: z.string().optional(),
  last_update: z.string().optional(),
  transaction_hash: z.string().optional(),
});

export const MidpointSchema = z.object({
  mid: z.string(),
});

export const PriceHistoryPointSchema = z.object({
  t: z.number(),
  p: z.number(),
});

// CLOB market details (by condition_id) - used for determining whether a market is tradable.
export const ClobMarketSchema = z.object({
  condition_id: z.string(),
  active: z.boolean().optional(),
  closed: z.boolean(),
  archived: z.boolean().optional(),
  accepting_orders: z.boolean().optional(),
  enable_order_book: z.boolean().optional(),
});

export type OrderbookLevel = z.infer<typeof OrderbookLevelSchema>;
export type Orderbook = z.infer<typeof OrderbookSchema>;
export type Trade = z.infer<typeof TradeSchema>;
export type Midpoint = z.infer<typeof MidpointSchema>;
export type PriceHistoryPoint = z.infer<typeof PriceHistoryPointSchema>;
export type ClobMarket = z.infer<typeof ClobMarketSchema>;

export interface OrderbookParams {
  token_id: string;
}

export interface TradesParams {
  asset_id: string;
  limit?: number;
  before?: string;
  after?: string;
}

export interface PriceHistoryParams {
  market: string;
  interval?: 'max' | '1w' | '1d' | '6h' | '1h';
  fidelity?: number;
}

export class ClobClient {
  private client: ApiClient;

  constructor(config?: Partial<ApiClientConfig>) {
    this.client = createApiClient({
      baseUrl: config?.baseUrl ?? 'https://clob.polymarket.com',
      ...config,
    });
  }

  /**
   * Get orderbook for a token
   */
  async getOrderbook(tokenId: string): Promise<Orderbook> {
    return this.client.get(
      '/book',
      { params: { token_id: tokenId } },
      OrderbookSchema
    );
  }

  /**
   * Get market details by condition_id (CLOB is authoritative for tradability).
   */
  async getMarket(conditionId: string): Promise<ClobMarket> {
    return this.client.get(
      `/markets/${conditionId}`,
      undefined,
      ClobMarketSchema
    );
  }

  /**
   * Get midpoint price for a token
   */
  async getMidpoint(tokenId: string): Promise<number> {
    const result = await this.client.get<Midpoint>(
      '/midpoint',
      { params: { token_id: tokenId } },
      MidpointSchema
    );
    return parseFloat(result.mid);
  }

  /**
   * Get recent trades for a token (asset_id)
   */
  async getTrades(assetId: string, limit = 100): Promise<Trade[]> {
    return this.client.get(
      '/data/trades',
      { params: { asset_id: assetId, limit } },
      z.array(TradeSchema)
    );
  }

  /**
   * Get price history for a market (condition)
   */
  async getPriceHistory(
    market: string,
    interval: PriceHistoryParams['interval'] = '1w',
    fidelity = 60
  ): Promise<PriceHistoryPoint[]> {
    const result = await this.client.get<{ history: PriceHistoryPoint[] }>(
      '/prices-history',
      { params: { market, interval, fidelity } }
    );
    return result.history ?? [];
  }

  /**
   * Get spread for a token
   */
  async getSpread(tokenId: string): Promise<{ bid: number | null; ask: number | null; spread: number | null }> {
    const orderbook = await this.getOrderbook(tokenId);

    const bestBid = orderbook.bids[0] ? parseFloat(orderbook.bids[0].price) : null;
    const bestAsk = orderbook.asks[0] ? parseFloat(orderbook.asks[0].price) : null;
    const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;

    return { bid: bestBid, ask: bestAsk, spread };
  }

  /**
   * Parse orderbook levels to numbers for easier processing
   */
  parseOrderbook(orderbook: Orderbook): {
    bids: Array<{ price: number; size: number }>;
    asks: Array<{ price: number; size: number }>;
  } {
    return {
      bids: orderbook.bids.map(l => ({
        price: parseFloat(l.price),
        size: parseFloat(l.size),
      })),
      asks: orderbook.asks.map(l => ({
        price: parseFloat(l.price),
        size: parseFloat(l.size),
      })),
    };
  }
}

/**
 * Create a CLOB API client
 */
export function createClobClient(config?: Partial<ApiClientConfig>): ClobClient {
  return new ClobClient(config);
}

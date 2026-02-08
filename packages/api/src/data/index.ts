/**
 * Data API client - Positions and activity
 * https://data-api.polymarket.com
 */

import { z } from 'zod';
import { ApiClient, createApiClient, type ApiClientConfig } from '../client';

// Data API Schemas
export const PositionSchema = z.object({
  asset: z.string(),
  condition_id: z.string(),
  outcome_index: z.number(),
  size: z.number(),
  avg_price: z.number().optional(),
  cur_price: z.number().optional(),
  initial_value: z.number().optional(),
  current_value: z.number().optional(),
  pnl: z.number().optional(),
  pnl_percent: z.number().optional(),
  realized_pnl: z.number().optional(),
  unrealized_pnl: z.number().optional(),
});

export const ActivitySchema = z.object({
  id: z.string().optional(),
  type: z.enum(['trade', 'transfer', 'redeem', 'split', 'merge']),
  timestamp: z.string(),
  asset: z.string().optional(),
  condition_id: z.string().optional(),
  side: z.enum(['BUY', 'SELL']).optional(),
  price: z.number().optional(),
  size: z.number().optional(),
  value: z.number().optional(),
  fee: z.number().optional(),
  transaction_hash: z.string().optional(),
});

// Public trades feed (global)
export const PublicTradeSchema = z.object({
  proxyWallet: z.string().optional(),
  side: z.enum(['BUY', 'SELL']),
  asset: z.string(),
  conditionId: z.string().optional(),
  size: z.number(),
  price: z.number(),
  timestamp: z.number(), // unix seconds
  transactionHash: z.string().optional(),

  // Extra fields commonly present in the response (kept optional for compatibility)
  title: z.string().optional(),
  slug: z.string().optional(),
  icon: z.string().optional(),
  eventSlug: z.string().optional(),
  outcome: z.string().optional(),
  outcomeIndex: z.number().optional(),
  name: z.string().optional(),
  pseudonym: z.string().optional(),
  bio: z.string().optional(),
  profileImage: z.string().optional(),
  profileImageOptimized: z.string().optional(),
});

export const UserBalanceSchema = z.object({
  usdc: z.number(),
  conditional_tokens: z.record(z.number()),
});

export type Position = z.infer<typeof PositionSchema>;
export type Activity = z.infer<typeof ActivitySchema>;
export type UserBalance = z.infer<typeof UserBalanceSchema>;
export type PublicTrade = z.infer<typeof PublicTradeSchema>;

export interface PositionsParams {
  user: string;
  sizeThreshold?: number;
}

export interface ActivityParams {
  user: string;
  limit?: number;
  offset?: number;
  type?: Activity['type'];
}

export interface PublicTradesParams {
  limit?: number;
  offset?: number;
}

export class DataClient {
  private client: ApiClient;

  constructor(config?: Partial<ApiClientConfig>) {
    this.client = createApiClient({
      baseUrl: config?.baseUrl ?? 'https://data-api.polymarket.com',
      ...config,
    });
  }

  /**
   * Get user positions
   */
  async getPositions(user: string, sizeThreshold = 0): Promise<Position[]> {
    return this.client.get(
      '/positions',
      { params: { user, sizeThreshold } },
      z.array(PositionSchema)
    );
  }

  /**
   * Get user activity/history
   */
  async getActivity(
    user: string,
    options: Partial<Omit<ActivityParams, 'user'>> = {}
  ): Promise<Activity[]> {
    return this.client.get(
      '/activity',
      { params: { user, ...options } },
      z.array(ActivitySchema)
    );
  }

  /**
   * Get recent public trades (global feed)
   */
  async getPublicTrades(limit = 200, offset = 0): Promise<PublicTrade[]> {
    return this.client.get(
      '/trades',
      { params: { limit, offset } },
      z.array(PublicTradeSchema)
    );
  }

  /**
   * Get open positions (size > 0)
   */
  async getOpenPositions(user: string): Promise<Position[]> {
    const positions = await this.getPositions(user, 0);
    return positions.filter(p => p.size > 0);
  }

  /**
   * Get positions that can be claimed (resolved markets)
   * This requires combining with Gamma API data to check market status
   */
  async getClaimablePositions(
    user: string,
    resolvedMarketIds: Set<string>
  ): Promise<Position[]> {
    const positions = await this.getOpenPositions(user);
    return positions.filter(p => resolvedMarketIds.has(p.condition_id));
  }

  /**
   * Calculate total portfolio value
   */
  async getPortfolioValue(user: string): Promise<{
    totalValue: number;
    totalPnL: number;
    positions: Position[];
  }> {
    const positions = await this.getOpenPositions(user);

    let totalValue = 0;
    let totalPnL = 0;

    for (const position of positions) {
      totalValue += position.current_value ?? 0;
      totalPnL += position.pnl ?? 0;
    }

    return { totalValue, totalPnL, positions };
  }

  /**
   * Get recent trades
   */
  async getRecentTrades(user: string, limit = 20): Promise<Activity[]> {
    const activity = await this.getActivity(user, { limit, type: 'trade' });
    return activity;
  }
}

/**
 * Create a Data API client
 */
export function createDataClient(config?: Partial<ApiClientConfig>): DataClient {
  return new DataClient(config);
}

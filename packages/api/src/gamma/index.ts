/**
 * Gamma API client - Market discovery and metadata
 * https://gamma-api.polymarket.com
 */

import { z } from 'zod';
import { ApiClient, createApiClient, type ApiClientConfig } from '../client';

// Gamma API Schemas - use passthrough to avoid strict validation issues
export const GammaOutcomeSchema = z.object({
  outcome: z.string(),
  outcome_id: z.string().optional(),
  price: z.number().optional(),
});

// Permissive schema that accepts the raw API response
export const GammaMarketSchema = z.object({
  id: z.string(),
  conditionId: z.string(),
  question: z.string(),
  description: z.string().optional().nullable(),
  outcomes: z.string(), // JSON string like "[\"Yes\", \"No\"]"
  outcomePrices: z.string().optional().nullable(),
  slug: z.string().optional().nullable(),
  endDateIso: z.string().optional().nullable(),
  closed: z.boolean().optional(),
  active: z.boolean().optional(),
  archived: z.boolean().optional(),
  volumeNum: z.number().optional(),
  volume24hr: z.number().optional(),
  liquidityNum: z.number().optional(),
  image: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  clobTokenIds: z.string().optional().nullable(),
}).passthrough();

// Tag schema - API returns objects, not strings
export const GammaTagSchema = z.object({
  id: z.string(),
  label: z.string(),
  slug: z.string(),
}).passthrough();

export const GammaEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional().nullable(),
  slug: z.string().optional().nullable(),
  image: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
  markets: z.array(GammaMarketSchema).optional(),
  category: z.string().optional().nullable(),
  tags: z.array(GammaTagSchema).optional(),
  end_date: z.string().optional().nullable(),
  active: z.boolean().optional(),
  closed: z.boolean().optional(),
  archived: z.boolean().optional(),
  volume: z.number().optional(),
  volume24hr: z.number().optional(),
  liquidity: z.number().optional(),
}).passthrough();

export const GammaMarketsResponseSchema = z.array(GammaMarketSchema);
export const GammaEventsResponseSchema = z.array(GammaEventSchema);

export type GammaOutcome = z.infer<typeof GammaOutcomeSchema>;
export type GammaMarketRaw = z.infer<typeof GammaMarketSchema>;
export type GammaTag = z.infer<typeof GammaTagSchema>;
export type GammaEvent = z.infer<typeof GammaEventSchema>;

// Normalized market type for internal use
export interface GammaMarket {
  id: string;
  condition_id: string;
  question: string;
  description?: string;
  outcomes: GammaOutcome[];
  slug?: string;
  end_date_iso?: string;
  closed?: boolean;
  active?: boolean;
  archived?: boolean;
  volume?: number;
  volume_24hr?: number;
  liquidity?: number;
  image?: string;
  icon?: string;
  category?: string;
  tokens?: Array<{ token_id: string; outcome: string; price?: number }>;
}

// Transform raw API response to normalized format
function transformMarket(raw: GammaMarketRaw): GammaMarket {
  // Parse JSON strings safely
  let outcomeNames: string[] = [];
  let outcomePrices: string[] = [];
  let tokenIds: string[] = [];

  try {
    outcomeNames = JSON.parse(raw.outcomes);
  } catch {
    outcomeNames = ['Yes', 'No'];
  }

  try {
    if (raw.outcomePrices) {
      outcomePrices = JSON.parse(raw.outcomePrices);
    }
  } catch {
    outcomePrices = [];
  }

  try {
    if (raw.clobTokenIds) {
      tokenIds = JSON.parse(raw.clobTokenIds);
    }
  } catch {
    tokenIds = [];
  }

  // Build outcomes array
  const outcomes = outcomeNames.map((name, i) => ({
    outcome: name,
    price: outcomePrices[i] ? parseFloat(outcomePrices[i]) : undefined,
  }));

  // Build tokens array
  const tokens = tokenIds.length > 0
    ? tokenIds.map((token_id, i) => ({
        token_id,
        outcome: outcomeNames[i] ?? '',
        price: outcomePrices[i] ? parseFloat(outcomePrices[i]) : undefined,
      }))
    : undefined;

  return {
    id: raw.id,
    condition_id: raw.conditionId,
    question: raw.question,
    description: raw.description ?? undefined,
    outcomes,
    slug: raw.slug ?? undefined,
    end_date_iso: raw.endDateIso ?? undefined,
    closed: raw.closed,
    active: raw.active,
    archived: raw.archived,
    volume: raw.volumeNum,
    volume_24hr: raw.volume24hr,
    liquidity: raw.liquidityNum,
    image: raw.image ?? undefined,
    icon: raw.icon ?? undefined,
    category: raw.category ?? undefined,
    tokens,
  };
}

export interface GammaMarketsParams {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  slug?: string;
  id?: string;
  tag?: string;
  order?: 'volume' | 'volume_24hr' | 'liquidity' | 'created_at';
  ascending?: boolean;
  end_date_min?: string; // Filter markets ending after this date (YYYY-MM-DD)
  end_date_max?: string; // Filter markets ending before this date (YYYY-MM-DD)
}

// Transform params to match Gamma API's expected parameter names
function transformParams(params?: GammaMarketsParams): Record<string, string | number | boolean | undefined> {
  if (!params) return {};

  const { order, ascending, ...rest } = params;
  const transformed: Record<string, string | number | boolean | undefined> = { ...rest };

  // Gamma API uses _order instead of order
  if (order !== undefined) {
    transformed['_order'] = order;
  }

  // Gamma API uses _ascending instead of ascending
  if (ascending !== undefined) {
    transformed['_ascending'] = ascending;
  }

  return transformed;
}

export interface GammaEventsParams {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  slug?: string;
  id?: string;
  tag?: string;
}

export class GammaClient {
  private client: ApiClient;

  constructor(config?: Partial<ApiClientConfig>) {
    this.client = createApiClient({
      baseUrl: config?.baseUrl ?? 'https://gamma-api.polymarket.com',
      ...config,
    });
  }

  /**
   * Get markets with optional filters
   */
  async getMarkets(params?: GammaMarketsParams): Promise<GammaMarket[]> {
    const apiParams = transformParams(params);
    const rawMarkets = await this.client.get<GammaMarketRaw[]>('/markets', { params: apiParams }, GammaMarketsResponseSchema);
    return rawMarkets.map(transformMarket);
  }

  /**
   * Get a single market by ID
   */
  async getMarket(id: string): Promise<GammaMarket> {
    const markets = await this.getMarkets({ id });
    if (markets.length === 0) {
      throw new Error(`Market not found: ${id}`);
    }
    return markets[0];
  }

  /**
   * Get a single market by slug
   */
  async getMarketBySlug(slug: string): Promise<GammaMarket> {
    const markets = await this.getMarkets({ slug });
    if (markets.length === 0) {
      throw new Error(`Market not found: ${slug}`);
    }
    return markets[0];
  }

  /**
   * Get events with optional filters
   */
  async getEvents(params?: GammaEventsParams): Promise<GammaEvent[]> {
    return this.client.get('/events', { params: params as Record<string, string | number | boolean | undefined> }, GammaEventsResponseSchema);
  }

  /**
   * Get a single event by ID
   */
  async getEvent(id: string): Promise<GammaEvent> {
    const events = await this.getEvents({ id });
    if (events.length === 0) {
      throw new Error(`Event not found: ${id}`);
    }
    return events[0];
  }

  /**
   * Get a single event by slug
   */
  async getEventBySlug(slug: string): Promise<GammaEvent> {
    const events = await this.getEvents({ slug });
    if (events.length === 0) {
      throw new Error(`Event not found: ${slug}`);
    }
    return events[0];
  }

  /**
   * Get trending markets (sorted by 24h volume)
   */
  async getTrendingMarkets(limit = 10): Promise<GammaMarket[]> {
    return this.getMarkets({
      limit,
      active: true,
      closed: false,
      order: 'volume_24hr',
      ascending: false,
    });
  }

  /**
   * Get markets by category
   */
  async getMarketsByCategory(tag: string, limit = 50): Promise<GammaMarket[]> {
    return this.getMarkets({
      tag,
      limit,
      active: true,
      closed: false,
    });
  }
}

/**
 * Create a Gamma API client
 */
export function createGammaClient(config?: Partial<ApiClientConfig>): GammaClient {
  return new GammaClient(config);
}

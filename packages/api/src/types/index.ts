/**
 * Shared API types for Polymarket
 */

import { z } from 'zod';

// Market schemas
export const OutcomeSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number().min(0).max(1),
});

export const MarketSchema = z.object({
  id: z.string(),
  conditionId: z.string(),
  question: z.string(),
  description: z.string().optional(),
  outcomes: z.array(OutcomeSchema),
  volume: z.number(),
  liquidity: z.number(),
  endDate: z.string().datetime().optional(),
  closed: z.boolean(),
  resolved: z.boolean(),
  category: z.string().optional(),
  image: z.string().url().optional(),
});

export type Outcome = z.infer<typeof OutcomeSchema>;
export type Market = z.infer<typeof MarketSchema>;

// Order schemas
export const OrderSideSchema = z.enum(['BUY', 'SELL']);
export const OrderStatusSchema = z.enum(['OPEN', 'FILLED', 'CANCELLED', 'EXPIRED']);

export const OrderSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  outcomeId: z.string(),
  side: OrderSideSchema,
  price: z.number().min(0).max(1),
  size: z.number().positive(),
  filledSize: z.number().min(0),
  status: OrderStatusSchema,
  createdAt: z.string().datetime(),
});

export type OrderSide = z.infer<typeof OrderSideSchema>;
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export type Order = z.infer<typeof OrderSchema>;

// Position schemas
export const PositionSchema = z.object({
  marketId: z.string(),
  outcomeId: z.string(),
  size: z.number(),
  avgPrice: z.number(),
  currentPrice: z.number(),
  pnl: z.number(),
  pnlPercent: z.number(),
});

export type Position = z.infer<typeof PositionSchema>;

// Orderbook schemas
export const OrderbookLevelSchema = z.object({
  price: z.number(),
  size: z.number(),
});

export const OrderbookSchema = z.object({
  bids: z.array(OrderbookLevelSchema),
  asks: z.array(OrderbookLevelSchema),
  timestamp: z.number(),
});

export type OrderbookLevel = z.infer<typeof OrderbookLevelSchema>;
export type Orderbook = z.infer<typeof OrderbookSchema>;

// Trade schemas
export const TradeSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  outcomeId: z.string(),
  price: z.number(),
  size: z.number(),
  side: OrderSideSchema,
  timestamp: z.string().datetime(),
});

export type Trade = z.infer<typeof TradeSchema>;

// API Response wrapper
export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    success: z.boolean(),
    error: z.string().optional(),
  });

export type ApiResponse<T> = {
  data: T;
  success: boolean;
  error?: string;
};

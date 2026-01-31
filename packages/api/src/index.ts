/**
 * @app/api - API clients for Polymarket services
 *
 * Exports:
 * - Base API client
 * - Gamma API client (markets, events)
 * - CLOB API client (trading, orderbook)
 * - Data API client (positions, activity)
 * - WebSocket manager
 * - Shared types
 */

// Base client
export {
  ApiClient,
  ApiError,
  createApiClient,
  type ApiClientConfig,
  type RequestOptions,
} from './client';

// Gamma API (markets, events)
export {
  GammaClient,
  createGammaClient,
  GammaMarketSchema,
  GammaEventSchema,
  GammaOutcomeSchema,
  type GammaMarket,
  type GammaEvent,
  type GammaOutcome,
  type GammaMarketsParams,
  type GammaEventsParams,
} from './gamma';

// CLOB API (trading, orderbook)
export {
  ClobClient,
  createClobClient,
  OrderbookSchema,
  TradeSchema,
  type Orderbook,
  type OrderbookLevel,
  type Trade,
  type PriceHistoryPoint,
} from './clob';

// Data API (positions, activity)
export {
  DataClient,
  createDataClient,
  PositionSchema,
  ActivitySchema,
  type Position,
  type Activity,
  type UserBalance,
} from './data';

// WebSocket
export {
  WebSocketManager,
  createWebSocketManager,
  type WebSocketConfig,
  type WebSocketMessage,
  type WebSocketSubscription,
  type MessageHandler,
} from './websocket';

// Types
export * from './types';

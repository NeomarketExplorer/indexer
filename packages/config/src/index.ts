/**
 * @app/config - Centralized configuration for the Polymarket trading app
 *
 * Contains:
 * - Environment variable schemas (Zod)
 * - API endpoints and URLs
 * - Chain configurations
 * - Feature flags
 */

// Environment configuration
export * from './env';

// Date/time utilities
export * from './date';

// API endpoints
export const API_ENDPOINTS = {
  gamma: {
    base: '/gamma-api.polymarket.com',
    markets: '/markets',
    events: '/events',
  },
  clob: {
    base: '/clob.polymarket.com',
    auth: '/auth',
    orders: '/orders',
    orderbook: '/book',
    trades: '/trades',
    midpoints: '/midpoints',
  },
  data: {
    base: '/data-api.polymarket.com',
    positions: '/positions',
    activity: '/activity',
  },
} as const;

// Chain configuration
export const CHAIN_CONFIG = {
  polygon: {
    chainId: 137,
    name: 'Polygon',
    rpcUrl: 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
    usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as const,
    ctf: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045' as const,
  },
} as const;

// Re-export zod for convenience
export { z } from 'zod';

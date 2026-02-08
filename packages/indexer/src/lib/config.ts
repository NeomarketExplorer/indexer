/**
 * Indexer configuration with Zod validation
 */

import { z } from 'zod';

const ConfigSchema = z.object({
  // Database
  databaseUrl: z.string().url().default('postgresql://postgres:postgres@localhost:5432/polymarket'),
  dbPoolMax: z.coerce.number().int().positive().default(20),
  queryTimeoutMs: z.coerce.number().int().positive().default(30000),

  // Server
  port: z.coerce.number().int().positive().default(3001),
  host: z.string().default('0.0.0.0'),

  // Sync intervals (in milliseconds)
  marketsSyncInterval: z.coerce.number().int().positive().default(5 * 60 * 1000), // 5 minutes
  tradesSyncInterval: z.coerce.number().int().positive().default(60 * 1000), // 1 minute
  priceFlushInterval: z.coerce.number().int().positive().default(1000), // 1 second

  // WebSocket
  // Polymarket "market" channel (the legacy /ws endpoint now returns 404)
  wsUrl: z.string().url().default('wss://ws-subscriptions-clob.polymarket.com/ws/market'),
  wsReconnectInterval: z.coerce.number().int().positive().default(3000),
  wsMaxReconnectAttempts: z.coerce.number().int().positive().default(10),

  // API URLs
  gammaApiUrl: z.string().url().default('https://gamma-api.polymarket.com'),
  clobApiUrl: z.string().url().default('https://clob.polymarket.com'),
  dataApiUrl: z.string().url().default('https://data-api.polymarket.com'),

  // Polymarket CLOB API auth (L2). Required for endpoints like /trades.
  polymarketApiKey: z.string().optional(),
  polymarketApiSecret: z.string().optional(),
  polymarketPassphrase: z.string().optional(),
  polymarketAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),

  // Batch sizes
  marketsBatchSize: z.coerce.number().int().positive().default(500),
  tradesBatchSize: z.coerce.number().int().positive().default(500),
  tradesSyncMarketLimit: z.coerce.number().int().positive().default(100),

  // Redis (optional — caching disabled if not set)
  redisUrl: z.string().url().optional(),

  // CORS
  corsOrigins: z.string().transform(s => s.split(',').map(o => o.trim())).default('http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000'),

  // Rate limiting
  rateLimitMax: z.coerce.number().int().positive().default(1000),
  rateLimitBurst: z.coerce.number().int().positive().default(2000),
  rateLimitWindowMs: z.coerce.number().int().positive().default(60 * 1000),

  // Data retention
  priceHistoryRetentionDays: z.coerce.number().int().positive().default(30),

  // Health: sync considered stale if older than this
  syncStaleThresholdMs: z.coerce.number().int().positive().default(15 * 60 * 1000),

  // Logging
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Environment
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
});

export type Config = z.infer<typeof ConfigSchema>;

let cachedConfig: Config | null = null;

/**
 * Get validated configuration from environment variables
 */
export function getConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const rawConfig = {
    databaseUrl: process.env.DATABASE_URL,
    dbPoolMax: process.env.DB_POOL_MAX,
    queryTimeoutMs: process.env.QUERY_TIMEOUT_MS,
    port: process.env.PORT,
    host: process.env.HOST,
    marketsSyncInterval: process.env.MARKETS_SYNC_INTERVAL,
    tradesSyncInterval: process.env.TRADES_SYNC_INTERVAL,
    priceFlushInterval: process.env.PRICE_FLUSH_INTERVAL,
    wsUrl: process.env.WS_URL,
    wsReconnectInterval: process.env.WS_RECONNECT_INTERVAL,
    wsMaxReconnectAttempts: process.env.WS_MAX_RECONNECT_ATTEMPTS,
    gammaApiUrl: process.env.GAMMA_API_URL,
    clobApiUrl: process.env.CLOB_API_URL,
    dataApiUrl: process.env.DATA_API_URL,
    polymarketApiKey: process.env.POLYMARKET_API_KEY,
    polymarketApiSecret: process.env.POLYMARKET_API_SECRET,
    polymarketPassphrase: process.env.POLYMARKET_PASSPHRASE,
    polymarketAddress: process.env.POLYMARKET_ADDRESS,
    marketsBatchSize: process.env.MARKETS_BATCH_SIZE,
    tradesBatchSize: process.env.TRADES_BATCH_SIZE,
    tradesSyncMarketLimit: process.env.TRADES_SYNC_MARKET_LIMIT,
    redisUrl: process.env.REDIS_URL,
    corsOrigins: process.env.CORS_ORIGINS,
    rateLimitMax: process.env.RATE_LIMIT_MAX,
    rateLimitBurst: process.env.RATE_LIMIT_BURST,
    rateLimitWindowMs: process.env.RATE_LIMIT_WINDOW_MS,
    priceHistoryRetentionDays: process.env.PRICE_HISTORY_RETENTION_DAYS,
    syncStaleThresholdMs: process.env.SYNC_STALE_THRESHOLD_MS,
    logLevel: process.env.LOG_LEVEL,
    nodeEnv: process.env.NODE_ENV,
  };

  // Remove undefined values so defaults are applied
  const cleanConfig = Object.fromEntries(
    Object.entries(rawConfig).filter(([, v]) => v !== undefined)
  );

  const result = ConfigSchema.safeParse(cleanConfig);

  if (!result.success) {
    process.stderr.write(`Invalid configuration: ${JSON.stringify(result.error.format(), null, 2)}\n`);
    throw new Error('Invalid configuration');
  }

  cachedConfig = result.data;
  return cachedConfig;
}

/**
 * Reset cached config (useful for testing)
 */
export function resetConfig(): void {
  cachedConfig = null;
}

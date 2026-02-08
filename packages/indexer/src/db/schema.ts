/**
 * PostgreSQL schema for Polymarket indexer
 * Using Drizzle ORM
 *
 * NOTE — Financial column precision (real → numeric)
 * ──────────────────────────────────────────────────
 * Several columns (volume, liquidity, price, size, PnL, etc.) currently use
 * `real` (float4, ~7 significant digits). For production financial accuracy
 * these should be migrated to `numeric(20,8)`. This is intentionally deferred
 * because it requires a table-rewrite ALTER that takes an ACCESS EXCLUSIVE lock
 * on every affected table.
 *
 * Follow-up plan:
 *   Phase 1 — Run `ALTER TABLE ... ALTER COLUMN ... TYPE numeric(20,8)` in a
 *             maintenance window against events, markets, trades, price_history,
 *             wallets, and positions. Largest tables first (price_history, trades).
 *   Phase 2 — Update this schema file: replace `real(...)` with
 *             `numeric('col', { precision: 20, scale: 8 })`.
 *   Phase 3 — Validate that Drizzle ORM returns `number` (not `string`) for
 *             numeric columns, or add `.mapWith(Number)` as needed.
 *   Estimated risk: low data-loss risk (widening), moderate downtime risk (lock).
 */

import {
  pgTable,
  text,
  varchar,
  boolean,
  integer,
  bigint,
  real,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  customType,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Custom tsvector type for full-text search
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// ============================================
// EVENTS
// ============================================

export const events = pgTable('events', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  slug: text('slug'),
  description: text('description'),
  image: text('image'),
  icon: text('icon'),
  startDate: timestamp('start_date', { withTimezone: true }),
  endDate: timestamp('end_date', { withTimezone: true }),
  volume: real('volume').default(0),
  volume24hr: real('volume_24hr').default(0),
  liquidity: real('liquidity').default(0),
  active: boolean('active').default(true),
  closed: boolean('closed').default(false),
  archived: boolean('archived').default(false),
  searchVector: tsvector('search_vector'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('events_slug_idx').on(table.slug),
  index('events_active_idx').on(table.active),
  index('events_volume_idx').on(table.volume),
  index('events_search_idx').using('gin', table.searchVector),
]);

// ============================================
// MARKETS
// ============================================

export const markets = pgTable('markets', {
  id: text('id').primaryKey(),
  eventId: text('event_id').references(() => events.id),
  conditionId: text('condition_id').notNull(),
  question: text('question').notNull(),
  description: text('description'),
  slug: text('slug'),

  // Outcomes stored as JSON arrays
  outcomes: jsonb('outcomes').$type<string[]>().notNull().default([]),
  outcomeTokenIds: jsonb('outcome_token_ids').$type<string[]>().notNull().default([]),
  outcomePrices: jsonb('outcome_prices').$type<number[]>().notNull().default([]),

  // Order book data (from WebSocket)
  bestBid: real('best_bid'),
  bestAsk: real('best_ask'),
  spread: real('spread'),
  lastTradePrice: real('last_trade_price'),

  // Volume/liquidity metrics
  volume: real('volume').default(0),
  volume24hr: real('volume_24hr').default(0),
  liquidity: real('liquidity').default(0),
  openInterest: real('open_interest'),

  // Metadata
  image: text('image'),
  icon: text('icon'),
  category: text('category'),
  endDateIso: text('end_date_iso'),

  // Status
  active: boolean('active').default(true),
  closed: boolean('closed').default(false),
  archived: boolean('archived').default(false),
  resolved: boolean('resolved').default(false),
  winningOutcome: integer('winning_outcome'),

  // Full-text search
  searchVector: tsvector('search_vector'),

  // Timestamps
  priceUpdatedAt: timestamp('price_updated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('markets_event_id_idx').on(table.eventId),
  index('markets_condition_id_idx').on(table.conditionId),
  index('markets_slug_idx').on(table.slug),
  index('markets_category_idx').on(table.category),
  index('markets_active_idx').on(table.active),
  index('markets_volume_idx').on(table.volume),
  index('markets_volume_24hr_idx').on(table.volume24hr),
  index('markets_liquidity_idx').on(table.liquidity),
  index('markets_search_idx').using('gin', table.searchVector),
]);

// ============================================
// TAGS
// ============================================

export const tags = pgTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('tags_slug_idx').on(table.slug),
]);

export const eventTags = pgTable('event_tags', {
  eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.eventId, table.tagId] }),
]);

export const marketTags = pgTable('market_tags', {
  marketId: text('market_id').notNull().references(() => markets.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.marketId, table.tagId] }),
]);

// ============================================
// PRICE HISTORY
// ============================================

export const priceHistory = pgTable('price_history', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  marketId: text('market_id').notNull().references(() => markets.id, { onDelete: 'cascade' }),
  tokenId: text('token_id').notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  price: real('price').notNull(),
  source: varchar('source', { length: 20 }).notNull().default('clob'), // 'clob' | 'websocket'
}, (table) => [
  index('price_history_market_id_idx').on(table.marketId),
  index('price_history_token_id_idx').on(table.tokenId),
  index('price_history_timestamp_idx').on(table.timestamp),
  index('price_history_market_timestamp_idx').on(table.marketId, table.timestamp),
  uniqueIndex('price_history_market_token_ts_source_uidx').on(table.marketId, table.tokenId, table.timestamp, table.source),
]);

// ============================================
// TRADES
// ============================================

export const trades = pgTable('trades', {
  id: text('id').primaryKey(),
  marketId: text('market_id').references(() => markets.id),
  tokenId: text('token_id').notNull(),
  side: varchar('side', { length: 4 }).notNull(), // 'BUY' | 'SELL'
  price: real('price').notNull(),
  size: real('size').notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  makerAddress: text('maker_address'),
  takerAddress: text('taker_address'),
  takerOrderId: text('taker_order_id'),
  transactionHash: text('transaction_hash'),
  feeRateBps: integer('fee_rate_bps'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('trades_market_id_idx').on(table.marketId),
  index('trades_token_id_idx').on(table.tokenId),
  index('trades_timestamp_idx').on(table.timestamp),
  index('trades_market_timestamp_idx').on(table.marketId, table.timestamp),
]);

// ============================================
// WALLETS — reserved for future user tracking.
// Not populated by any sync code yet.
// ============================================

export const wallets = pgTable('wallets', {
  address: text('address').primaryKey(),
  username: text('username'),
  profileImage: text('profile_image'),
  totalPnl: real('total_pnl').default(0),
  totalVolume: real('total_volume').default(0),
  tradeCount: integer('trade_count').default(0),
  winCount: integer('win_count').default(0),
  lossCount: integer('loss_count').default(0),
  winRate: real('win_rate'),
  firstTradeAt: timestamp('first_trade_at', { withTimezone: true }),
  lastTradeAt: timestamp('last_trade_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('wallets_username_idx').on(table.username),
  index('wallets_total_pnl_idx').on(table.totalPnl),
  index('wallets_total_volume_idx').on(table.totalVolume),
]);

// ============================================
// POSITIONS — reserved for future user tracking.
// Not populated by any sync code yet.
// ============================================

export const positions = pgTable('positions', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  walletAddress: text('wallet_address').notNull().references(() => wallets.address, { onDelete: 'cascade' }),
  marketId: text('market_id').notNull().references(() => markets.id, { onDelete: 'cascade' }),
  tokenId: text('token_id').notNull(),
  outcomeIndex: integer('outcome_index').notNull(),
  size: real('size').notNull(),
  avgPrice: real('avg_price'),
  currentPrice: real('current_price'),
  unrealizedPnl: real('unrealized_pnl'),
  realizedPnl: real('realized_pnl'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('positions_wallet_address_idx').on(table.walletAddress),
  index('positions_market_id_idx').on(table.marketId),
  uniqueIndex('positions_wallet_market_token_idx').on(table.walletAddress, table.marketId, table.tokenId),
]);

// ============================================
// SYNC STATE
// ============================================

export const syncState = pgTable('sync_state', {
  entity: text('entity').primaryKey(), // 'markets' | 'events' | 'trades' | 'prices' | 'wallets'
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastOffset: integer('last_offset').default(0),
  lastCursor: text('last_cursor'),
  status: varchar('status', { length: 20 }).default('idle'), // 'idle' | 'syncing' | 'error'
  errorMessage: text('error_message'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ============================================
// RELATIONS
// ============================================

export const eventsRelations = relations(events, ({ many }) => ({
  markets: many(markets),
  eventTags: many(eventTags),
}));

export const marketsRelations = relations(markets, ({ one, many }) => ({
  event: one(events, {
    fields: [markets.eventId],
    references: [events.id],
  }),
  priceHistory: many(priceHistory),
  trades: many(trades),
  marketTags: many(marketTags),
  positions: many(positions),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  eventTags: many(eventTags),
  marketTags: many(marketTags),
}));

export const eventTagsRelations = relations(eventTags, ({ one }) => ({
  event: one(events, {
    fields: [eventTags.eventId],
    references: [events.id],
  }),
  tag: one(tags, {
    fields: [eventTags.tagId],
    references: [tags.id],
  }),
}));

export const marketTagsRelations = relations(marketTags, ({ one }) => ({
  market: one(markets, {
    fields: [marketTags.marketId],
    references: [markets.id],
  }),
  tag: one(tags, {
    fields: [marketTags.tagId],
    references: [tags.id],
  }),
}));

export const priceHistoryRelations = relations(priceHistory, ({ one }) => ({
  market: one(markets, {
    fields: [priceHistory.marketId],
    references: [markets.id],
  }),
}));

export const tradesRelations = relations(trades, ({ one }) => ({
  market: one(markets, {
    fields: [trades.marketId],
    references: [markets.id],
  }),
}));

export const walletsRelations = relations(wallets, ({ many }) => ({
  positions: many(positions),
}));

export const positionsRelations = relations(positions, ({ one }) => ({
  wallet: one(wallets, {
    fields: [positions.walletAddress],
    references: [wallets.address],
  }),
  market: one(markets, {
    fields: [positions.marketId],
    references: [markets.id],
  }),
}));

// ============================================
// TYPE EXPORTS
// ============================================

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

export type Market = typeof markets.$inferSelect;
export type NewMarket = typeof markets.$inferInsert;

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;

export type PriceHistory = typeof priceHistory.$inferSelect;
export type NewPriceHistory = typeof priceHistory.$inferInsert;

export type Trade = typeof trades.$inferSelect;
export type NewTrade = typeof trades.$inferInsert;

export type Wallet = typeof wallets.$inferSelect;
export type NewWallet = typeof wallets.$inferInsert;

export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;

export type SyncState = typeof syncState.$inferSelect;
export type NewSyncState = typeof syncState.$inferInsert;

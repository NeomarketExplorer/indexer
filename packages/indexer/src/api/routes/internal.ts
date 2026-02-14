/**
 * Internal/export endpoints for cross-system sync.
 *
 * These are intended for server-to-server usage (e.g. ClickHouse metadata sync).
 * If INTERNAL_API_TOKEN is set, callers must provide `x-internal-token`.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { events, getDb, markets } from '../../db';

export const internalRouter = new Hono();

internalRouter.use('*', async (c, next) => {
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token) return next();
  const provided = c.req.header('x-internal-token');
  if (!provided || provided !== token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
});

const ExportMarketCategoriesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(5000).default(1000),
  offset: z.coerce.number().int().min(0).default(0),
  since: z.string().optional(), // ISO string
});

/**
 * GET /internal/export/market-categories
 *
 * Returns condition_id -> event_id/categories mapping (plus event title/slug),
 * used to enrich ClickHouse analytics with the Postgres taxonomy.
 */
internalRouter.get('/export/market-categories', async (c) => {
  const query = ExportMarketCategoriesQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: 'Invalid query parameters', details: query.error.format() }, 400);
  }

  const { limit, offset, since } = query.data;
  const db = getDb();

  const conditions: SQL[] = [];
  if (since) {
    const sinceDate = new Date(since);
    if (!Number.isFinite(sinceDate.getTime())) {
      return c.json({ error: 'Invalid since; expected ISO timestamp' }, 400);
    }
    // If either the market row or its parent event changed, export it.
    conditions.push(
      gte(sql`GREATEST(${markets.updatedAt}, ${events.updatedAt})`, sinceDate),
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      condition_id: markets.conditionId,
      market_id: markets.id,
      event_id: events.id,
      event_title: events.title,
      event_slug: events.slug,
      categories: events.categories,
      updated_at: sql<Date>`GREATEST(${markets.updatedAt}, ${events.updatedAt})`,
    })
    .from(markets)
    .leftJoin(events, eq(markets.eventId, events.id))
    .where(where)
    .orderBy(asc(sql`GREATEST(${markets.updatedAt}, ${events.updatedAt})`), asc(markets.id))
    .limit(limit)
    .offset(offset);

  return c.json({
    data: rows.map((r) => ({
      condition_id: r.condition_id,
      market_id: r.market_id,
      event_id: r.event_id ?? null,
      event_title: r.event_title ?? null,
      event_slug: r.event_slug ?? null,
      categories: (r.categories ?? []) as string[],
      updated_at: r.updated_at?.toISOString?.() ?? null,
    })),
    pagination: {
      limit,
      offset,
      hasMore: rows.length === limit,
    },
  });
});


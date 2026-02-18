/**
 * Internal/export endpoints for cross-system sync.
 *
 * These are intended for server-to-server usage (e.g. ClickHouse metadata sync).
 * If INTERNAL_API_TOKEN is set, callers must provide `x-internal-token`.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, eq, sql } from 'drizzle-orm';
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

  // Postgres GREATEST() returns NULL if ANY argument is NULL; production data may
  // contain legacy NULL updated_at values. Coalesce to epoch so export is stable
  // and incremental sync works.
  const updatedAtExpr = sql<Date>`
    GREATEST(
      COALESCE(${markets.updatedAt}, to_timestamp(0)),
      COALESCE(${events.updatedAt}, to_timestamp(0))
    )
  `;

  const conditions: SQL[] = [];
  if (since) {
    const sinceDate = new Date(since);
    if (!Number.isFinite(sinceDate.getTime())) {
      return c.json({ error: 'Invalid since; expected ISO timestamp' }, 400);
    }
    const sinceIso = sinceDate.toISOString();
    // If either the market row or its parent event changed, export it.
    conditions.push(sql`${updatedAtExpr} >= ${sinceIso}::timestamptz`);
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
      updated_at: updatedAtExpr,
    })
    .from(markets)
    .leftJoin(events, eq(markets.eventId, events.id))
    .where(where)
    .orderBy(asc(updatedAtExpr), asc(markets.id))
    .limit(limit)
    .offset(offset);

  const toIso = (value: unknown): string | null => {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    }
    const d = new Date(String(value));
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  };

  return c.json({
    data: rows.map((r) => ({
      condition_id: r.condition_id,
      market_id: r.market_id,
      event_id: r.event_id ?? null,
      event_title: r.event_title ?? null,
      event_slug: r.event_slug ?? null,
      categories: (r.categories ?? []) as string[],
      updated_at: toIso(r.updated_at),
    })),
    pagination: {
      limit,
      offset,
      hasMore: rows.length === limit,
    },
  });
});

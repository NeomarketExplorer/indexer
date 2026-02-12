/**
 * Categories API endpoints
 *
 * Exposes the custom 2-level category taxonomy with event counts,
 * plus audit/coverage endpoints for accuracy measurement.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { getDb, events } from '../../db';
import { cached } from '../middleware/cache';
import { getAllCategories, getCategoryLabel } from '../../lib/categories';

export const categoriesRouter = new Hono();

/**
 * GET /categories — Full taxonomy tree with event counts per category.
 */
categoriesRouter.get('/', cached({ ttl: 120 }), async (c) => {
  const db = getDb();

  // Get counts for every slug that appears in any event's categories array.
  const counts = await db.execute(sql`
    SELECT cat.value #>> '{}' AS slug, count(*)::int AS count
    FROM events, jsonb_array_elements(categories) AS cat(value)
    GROUP BY cat.value
    ORDER BY count(*) DESC
  `) as unknown as Array<{ slug: string; count: number }>;

  const countMap = new Map(counts.map(r => [r.slug, r.count]));

  const tree = getAllCategories().map(parent => ({
    slug: parent.slug,
    label: parent.label,
    count: countMap.get(parent.slug) ?? 0,
    children: parent.children.map(child => ({
      slug: child.slug,
      label: child.label,
      count: countMap.get(child.slug) ?? 0,
    })),
  }));

  return c.json({ data: tree });
});

/**
 * GET /categories/audit — Random sample of events for manual accuracy review.
 */
categoriesRouter.get('/audit', cached({ ttl: 30 }), async (c) => {
  const schema = z.object({
    n: z.coerce.number().int().positive().max(100).default(20),
    category: z.string().optional(),
    seed: z.coerce.number().optional(),
  });

  const query = schema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: 'Invalid query parameters', details: query.error.format() }, 400);
  }

  const { n, category, seed } = query.data;
  const db = getDb();

  const seedVal = seed ?? Math.floor(Math.random() * 1_000_000);

  const conditions: ReturnType<typeof sql>[] = [];
  if (category) {
    conditions.push(sql`categories @> ${JSON.stringify([category])}::jsonb`);
  }
  const whereClause = conditions.length > 0
    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
    : sql``;

  const rows = await db.execute(sql`
    SELECT id, title, description, categories, gamma_category
    FROM events
    ${whereClause}
    ORDER BY md5(id || ${String(seedVal)})
    LIMIT ${n}
  `) as unknown as Array<{
    id: string;
    title: string;
    description: string | null;
    categories: string[];
    gamma_category: string | null;
  }>;

  const data = rows.map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    categories: r.categories ?? [],
    categoryLabels: (r.categories ?? []).map(s => getCategoryLabel(s) ?? s),
    gammaCategory: r.gamma_category,
  }));

  return c.json({ data, seed: seedVal, count: data.length });
});

/**
 * GET /categories/unmatched — Uncategorized events + coverage stats.
 */
categoriesRouter.get('/unmatched', cached({ ttl: 60 }), async (c) => {
  const schema = z.object({
    limit: z.coerce.number().int().positive().max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  });

  const query = schema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: 'Invalid query parameters', details: query.error.format() }, 400);
  }

  const { limit, offset } = query.data;
  const db = getDb();

  // Coverage stats
  const [stats] = await db.execute(sql`
    SELECT
      count(*)::int AS total_events,
      count(*) FILTER (WHERE jsonb_array_length(categories) > 0)::int AS categorized,
      count(*) FILTER (WHERE jsonb_array_length(categories) = 0)::int AS uncategorized
    FROM events
  `) as unknown as [{ total_events: number; categorized: number; uncategorized: number }];

  const total = stats.total_events;
  const coveragePct = total > 0 ? Math.round((stats.categorized / total) * 1000) / 10 : 0;

  // Uncategorized events, highest volume first
  const rows = await db.execute(sql`
    SELECT id, title, description, gamma_category, volume
    FROM events
    WHERE jsonb_array_length(categories) = 0
    ORDER BY volume DESC NULLS LAST
    LIMIT ${limit} OFFSET ${offset}
  `) as unknown as Array<{
    id: string;
    title: string;
    description: string | null;
    gamma_category: string | null;
    volume: number | null;
  }>;

  return c.json({
    coverage: {
      total_events: stats.total_events,
      categorized: stats.categorized,
      uncategorized: stats.uncategorized,
      coverage_pct: coveragePct,
    },
    uncategorized_events: rows,
    pagination: {
      limit,
      offset,
      total: stats.uncategorized,
      hasMore: offset + rows.length < stats.uncategorized,
    },
  });
});

/**
 * GET /categories/stats — Category distribution stats.
 */
categoriesRouter.get('/stats', cached({ ttl: 120 }), async (c) => {
  const db = getDb();

  // Per-category counts
  const perCategory = await db.execute(sql`
    SELECT cat.value #>> '{}' AS slug, count(*)::int AS count
    FROM events, jsonb_array_elements(categories) AS cat(value)
    GROUP BY cat.value
    ORDER BY count(*) DESC
  `) as unknown as Array<{ slug: string; count: number }>;

  // Overlap stats: how many events have 1, 2, 3+ categories (child-level only)
  const overlap = await db.execute(sql`
    SELECT
      child_count,
      count(*)::int AS events
    FROM (
      SELECT id,
        (SELECT count(*)::int FROM jsonb_array_elements_text(categories) c WHERE c LIKE '%/%') AS child_count
      FROM events
      WHERE jsonb_array_length(categories) > 0
    ) sub
    GROUP BY child_count
    ORDER BY child_count
  `) as unknown as Array<{ child_count: number; events: number }>;

  // Average categories per event
  const [avgRow] = await db.execute(sql`
    SELECT
      avg(jsonb_array_length(categories))::real AS avg_categories,
      count(*)::int AS total_events
    FROM events
  `) as unknown as [{ avg_categories: number; total_events: number }];

  return c.json({
    data: {
      perCategory: perCategory.map(r => ({
        slug: r.slug,
        label: getCategoryLabel(r.slug) ?? r.slug,
        count: r.count,
      })),
      overlap: overlap.map(r => ({
        childCategories: r.child_count,
        events: r.events,
      })),
      avgCategoriesPerEvent: Math.round((avgRow.avg_categories ?? 0) * 100) / 100,
      totalEvents: avgRow.total_events,
    },
  });
});

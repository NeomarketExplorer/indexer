/**
 * Stats API endpoints
 */

import { Hono } from 'hono';
import { sql, eq } from 'drizzle-orm';
import { getDb, markets, events, trades } from '../../db';
import { cached } from '../middleware/cache';

export const statsRouter = new Hono();

/**
 * GET /stats - Platform overview statistics
 */
statsRouter.get('/', cached({ ttl: 120 }), async (c) => {
  const db = getDb();

  // Get market counts
  const marketStats = await db
    .select({
      total: sql<number>`count(*)`,
      active: sql<number>`count(*) filter (where active = true)`,
      closed: sql<number>`count(*) filter (where closed = true)`,
      live: sql<number>`count(*) filter (where active = true and closed = false)`,
      totalVolume: sql<number>`coalesce(sum(volume), 0)`,
      totalVolume24hr: sql<number>`coalesce(sum(volume_24hr), 0)`,
      totalLiquidity: sql<number>`coalesce(sum(liquidity), 0)`,
    })
    .from(markets);

  // Get event counts
  const eventStats = await db
    .select({
      total: sql<number>`count(*)`,
      active: sql<number>`count(*) filter (where active = true)`,
      closed: sql<number>`count(*) filter (where closed = true)`,
      live: sql<number>`count(*) filter (where active = true and closed = false)`,
    })
    .from(events);

  // Get trade counts
  const tradeStats = await db
    .select({
      total: sql<number>`count(*)`,
      last24hr: sql<number>`count(*) filter (where timestamp > now() - interval '24 hours')`,
    })
    .from(trades);

  // Get category breakdown
  const categories = await db
    .select({
      category: markets.category,
      count: sql<number>`count(*)`,
      volume: sql<number>`coalesce(sum(volume), 0)`,
    })
    .from(markets)
    .where(eq(markets.active, true))
    .groupBy(markets.category)
    .orderBy(sql`sum(volume) desc`)
    .limit(10);

  const toNumber = (value: number | string | null | undefined) =>
    value == null ? 0 : typeof value === 'string' ? Number(value) : value;

  return c.json({
    data: {
      markets: {
        total: toNumber(marketStats[0]?.total),
        active: toNumber(marketStats[0]?.active),
        closed: toNumber(marketStats[0]?.closed),
        live: toNumber(marketStats[0]?.live),
      },
      events: {
        total: toNumber(eventStats[0]?.total),
        active: toNumber(eventStats[0]?.active),
        closed: toNumber(eventStats[0]?.closed),
        live: toNumber(eventStats[0]?.live),
      },
      trades: {
        total: toNumber(tradeStats[0]?.total),
        last24hr: toNumber(tradeStats[0]?.last24hr),
      },
      volume: {
        total: toNumber(marketStats[0]?.totalVolume),
        last24hr: toNumber(marketStats[0]?.totalVolume24hr),
      },
      liquidity: toNumber(marketStats[0]?.totalLiquidity),
      categories: categories.map(c => ({
        name: c.category ?? 'Uncategorized',
        count: toNumber(c.count),
        volume: toNumber(c.volume),
      })),
      customCategories: await getCustomCategoryStats(db),
      updatedAt: new Date().toISOString(),
    },
  });
});

async function getCustomCategoryStats(db: ReturnType<typeof getDb>) {
  const rows = await db.execute(sql`
    SELECT cat.value #>> '{}' AS slug, count(*)::int AS count
    FROM events, jsonb_array_elements(categories) AS cat(value)
    GROUP BY cat.value
    ORDER BY count(*) DESC
    LIMIT 20
  `) as unknown as Array<{ slug: string; count: number }>;

  return rows.map(r => ({ slug: r.slug, count: r.count }));
}

/**
 * GET /stats/sync - Sync status
 */
statsRouter.get('/sync', cached({ ttl: 30 }), async (c) => {
  const db = getDb();

  const syncStates = await db.query.syncState.findMany();

  const stateMap = Object.fromEntries(
    syncStates.map(s => [
      s.entity,
      {
        status: s.status,
        lastSyncAt: s.lastSyncAt,
        error: s.errorMessage,
        metadata: s.metadata,
      },
    ])
  );

  return c.json({
    data: stateMap,
    updatedAt: new Date().toISOString(),
  });
});

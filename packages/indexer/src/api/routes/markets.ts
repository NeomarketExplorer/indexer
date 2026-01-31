/**
 * Markets API endpoints
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { eq, desc, asc, and, sql } from 'drizzle-orm';
import { getDb, markets, priceHistory, trades } from '../../db';
import { cached } from '../middleware/cache';
import { ftsWhere } from '../../db/search';

export const marketsRouter = new Hono();

// Query params schema
const ListMarketsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  active: z.enum(['true', 'false']).optional(),
  closed: z.enum(['true', 'false']).optional(),
  category: z.string().optional(),
  sort: z.enum(['volume', 'volume_24hr', 'liquidity', 'created_at']).default('volume_24hr'),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
});

/**
 * GET /markets - List markets with filters
 */
marketsRouter.get('/', cached({ ttl: 60 }), async (c) => {
  const query = ListMarketsQuerySchema.safeParse(c.req.query());

  if (!query.success) {
    return c.json({ error: 'Invalid query parameters', details: query.error.format() }, 400);
  }

  const { limit, offset, active, closed, category, sort, order, search } = query.data;
  const db = getDb();

  // Build where conditions
  const conditions: ReturnType<typeof eq>[] = [];

  if (active !== undefined) {
    conditions.push(eq(markets.active, active === 'true'));
  }

  if (closed !== undefined) {
    conditions.push(eq(markets.closed, closed === 'true'));
  }

  if (category) {
    conditions.push(eq(markets.category, category));
  }

  if (search) {
    conditions.push(ftsWhere(markets.searchVector, search));
  }

  // Build order by
  const sortColumn = {
    volume: markets.volume,
    volume_24hr: markets.volume24hr,
    liquidity: markets.liquidity,
    created_at: markets.createdAt,
  }[sort];

  const orderBy = order === 'desc' ? desc(sortColumn) : asc(sortColumn);

  // Execute query
  const result = await db.query.markets.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [orderBy],
    limit,
    offset,
    with: {
      event: {
        columns: {
          id: true,
          title: true,
          slug: true,
        },
      },
    },
  });

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(markets)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const total = countResult[0]?.count ?? 0;

  return c.json({
    data: result,
    pagination: {
      limit,
      offset,
      total,
      hasMore: offset + result.length < total,
    },
  });
});

/**
 * GET /markets/search - Full-text search
 */
marketsRouter.get('/search', cached({ ttl: 90 }), async (c) => {
  const q = c.req.query('q');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);

  if (!q || q.length < 2) {
    return c.json({ error: 'Query must be at least 2 characters' }, 400);
  }

  const db = getDb();

  const result = await db.query.markets.findMany({
    where: ftsWhere(markets.searchVector, q),
    orderBy: [desc(markets.volume24hr)],
    limit,
    columns: {
      id: true,
      question: true,
      slug: true,
      outcomes: true,
      outcomePrices: true,
      volume24hr: true,
      active: true,
      category: true,
    },
  });

  return c.json({ data: result, query: q });
});

/**
 * GET /markets/:id - Single market by ID
 */
marketsRouter.get('/:id', cached({ ttl: 30 }), async (c) => {
  const id = c.req.param('id');
  const db = getDb();

  const market = await db.query.markets.findFirst({
    where: eq(markets.id, id),
    with: {
      event: true,
    },
  });

  if (!market) {
    return c.json({ error: 'Market not found' }, 404);
  }

  return c.json({ data: market });
});

/**
 * GET /markets/:id/history - Price history for a market
 */
marketsRouter.get('/:id/history', cached({ ttl: 45 }), async (c) => {
  const id = c.req.param('id');
  const interval = c.req.query('interval') ?? '1w';
  const limit = Math.min(parseInt(c.req.query('limit') ?? '500', 10), 1000);
  const db = getDb();

  // Verify market exists
  const market = await db.query.markets.findFirst({
    where: eq(markets.id, id),
    columns: { id: true },
  });

  if (!market) {
    return c.json({ error: 'Market not found' }, 404);
  }

  // Calculate time range based on interval
  const now = new Date();
  let startDate: Date;

  switch (interval) {
    case '1h':
      startDate = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case '6h':
      startDate = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      break;
    case '1d':
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case '1w':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'max':
    default:
      startDate = new Date(0);
  }

  const history = await db.query.priceHistory.findMany({
    where: and(
      eq(priceHistory.marketId, id),
      sql`${priceHistory.timestamp} >= ${startDate}`
    ),
    orderBy: [desc(priceHistory.timestamp)],
    limit,
    columns: {
      tokenId: true,
      timestamp: true,
      price: true,
    },
  });

  return c.json({
    data: history,
    interval,
    startDate: startDate.toISOString(),
    endDate: now.toISOString(),
  });
});

/**
 * GET /markets/:id/trades - Recent trades for a market
 */
marketsRouter.get('/:id/trades', cached({ ttl: 15 }), async (c) => {
  const id = c.req.param('id');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const db = getDb();

  // Verify market exists
  const market = await db.query.markets.findFirst({
    where: eq(markets.id, id),
    columns: { id: true },
  });

  if (!market) {
    return c.json({ error: 'Market not found' }, 404);
  }

  const recentTrades = await db.query.trades.findMany({
    where: eq(trades.marketId, id),
    orderBy: [desc(trades.timestamp)],
    limit,
  });

  return c.json({ data: recentTrades });
});

/**
 * POST /markets/prices - Batch price lookup
 */
marketsRouter.post('/prices', async (c) => {
  const body = await c.req.json<{ ids: string[] }>();

  if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: 'ids array is required' }, 400);
  }

  if (body.ids.length > 100) {
    return c.json({ error: 'Maximum 100 ids per request' }, 400);
  }

  const db = getDb();

  const result = await db.query.markets.findMany({
    where: sql`${markets.id} IN ${body.ids}`,
    columns: {
      id: true,
      outcomePrices: true,
      lastTradePrice: true,
      bestBid: true,
      bestAsk: true,
      priceUpdatedAt: true,
    },
  });

  // Convert to map for easy lookup
  const prices = Object.fromEntries(
    result.map(m => [
      m.id,
      {
        prices: m.outcomePrices,
        lastTradePrice: m.lastTradePrice,
        bestBid: m.bestBid,
        bestAsk: m.bestAsk,
        updatedAt: m.priceUpdatedAt,
      },
    ])
  );

  return c.json({ data: prices });
});

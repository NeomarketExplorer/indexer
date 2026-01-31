/**
 * Events API endpoints
 *
 * Fix applied:
 * - #18 Optional count via ?includeCount=false
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { eq, desc, asc, and, sql } from 'drizzle-orm';
import { getDb, events } from '../../db';
import { cached } from '../middleware/cache';
import { ftsWhere } from '../../db/search';

export const eventsRouter = new Hono();

// Query params schema
const ListEventsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  active: z.enum(['true', 'false']).optional(),
  closed: z.enum(['true', 'false']).optional(),
  sort: z.enum(['volume', 'volume_24hr', 'liquidity', 'created_at']).default('volume'),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
  includeCount: z.enum(['true', 'false']).default('true'),
});

/**
 * GET /events - List events with filters
 */
eventsRouter.get('/', cached({ ttl: 60 }), async (c) => {
  const query = ListEventsQuerySchema.safeParse(c.req.query());

  if (!query.success) {
    return c.json({ error: 'Invalid query parameters', details: query.error.format() }, 400);
  }

  const { limit, offset, active, closed, sort, order, search, includeCount } = query.data;
  const db = getDb();

  // Build where conditions
  const conditions: ReturnType<typeof eq>[] = [];

  if (active !== undefined) {
    conditions.push(eq(events.active, active === 'true'));
  }

  if (closed !== undefined) {
    conditions.push(eq(events.closed, closed === 'true'));
  }

  if (search) {
    conditions.push(ftsWhere(events.searchVector, search));
  }

  // Build order by
  const sortColumn = {
    volume: events.volume,
    volume_24hr: events.volume24hr,
    liquidity: events.liquidity,
    created_at: events.createdAt,
  }[sort];

  const orderBy = order === 'desc' ? desc(sortColumn) : asc(sortColumn);

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Execute query
  const result = await db.query.events.findMany({
    where: whereClause,
    orderBy: [orderBy],
    limit,
    offset,
  });

  // (#18) Count is optional — skip on large datasets when not needed
  let total: number | null = null;
  if (includeCount === 'true') {
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(events)
      .where(whereClause);
    total = countResult[0]?.count ?? 0;
  }

  return c.json({
    data: result,
    pagination: {
      limit,
      offset,
      total,
      hasMore: total !== null ? offset + result.length < total : result.length === limit,
    },
  });
});

/**
 * GET /events/:id - Single event with markets
 */
eventsRouter.get('/:id', cached({ ttl: 30 }), async (c) => {
  const id = c.req.param('id');
  const db = getDb();

  const event = await db.query.events.findFirst({
    where: eq(events.id, id),
    with: {
      markets: {
        orderBy: (markets, { desc }) => [desc(markets.volume24hr)],
      },
    },
  });

  if (!event) {
    return c.json({ error: 'Event not found' }, 404);
  }

  return c.json({ data: event });
});

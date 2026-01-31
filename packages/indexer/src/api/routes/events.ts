/**
 * Events API endpoints
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
});

/**
 * GET /events - List events with filters
 */
eventsRouter.get('/', cached({ ttl: 60 }), async (c) => {
  const query = ListEventsQuerySchema.safeParse(c.req.query());

  if (!query.success) {
    return c.json({ error: 'Invalid query parameters', details: query.error.format() }, 400);
  }

  const { limit, offset, active, closed, sort, order, search } = query.data;
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

  // Execute query
  const result = await db.query.events.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [orderBy],
    limit,
    offset,
  });

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
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

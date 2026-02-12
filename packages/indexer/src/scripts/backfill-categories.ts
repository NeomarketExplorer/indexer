/**
 * One-time backfill: classify all existing events and populate the
 * `categories` column. Idempotent — safe to re-run.
 *
 * Usage:
 *   npx tsx packages/indexer/src/scripts/backfill-categories.ts
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql, eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import { classifyEvent } from '../lib/categories';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/polymarket';
const BATCH_SIZE = 1000;

async function main() {
  const client = postgres(DATABASE_URL, { max: 3 });
  const db = drizzle(client, { schema });

  console.log('Starting category backfill...');

  let processed = 0;
  let categorized = 0;
  let offset = 0;

  while (true) {
    const batch = await db.query.events.findMany({
      columns: {
        id: true,
        title: true,
        description: true,
        gammaCategory: true,
      },
      orderBy: [schema.events.id],
      limit: BATCH_SIZE,
      offset,
    });

    if (batch.length === 0) break;

    // Fetch tag labels for these events
    const eventIds = batch.map(e => e.id);
    const idList = sql.join(eventIds.map(id => sql`${id}`), sql`,`);
    const tagRows = await db.execute(sql`
      SELECT et.event_id, t.label
      FROM event_tags et
      JOIN tags t ON t.id = et.tag_id
      WHERE et.event_id IN (${idList})
    `) as unknown as Array<{ event_id: string; label: string }>;

    const tagsByEvent = new Map<string, string[]>();
    for (const row of tagRows) {
      const arr = tagsByEvent.get(row.event_id) ?? [];
      arr.push(row.label);
      tagsByEvent.set(row.event_id, arr);
    }

    // Classify and update
    for (const event of batch) {
      const categories = classifyEvent({
        title: event.title,
        description: event.description,
        gammaCategory: event.gammaCategory,
        gammaTags: tagsByEvent.get(event.id) ?? [],
      });

      await db.update(schema.events)
        .set({ categories })
        .where(eq(schema.events.id, event.id));

      processed++;
      if (categories.length > 0) categorized++;
    }

    offset += batch.length;
    console.log(`Processed ${processed} events (${categorized} categorized so far)`);
  }

  const coveragePct = processed > 0 ? Math.round((categorized / processed) * 1000) / 10 : 0;
  console.log(`\nBackfill complete: ${processed} events, ${categorized} categorized (${coveragePct}% coverage)`);

  await client.end();
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

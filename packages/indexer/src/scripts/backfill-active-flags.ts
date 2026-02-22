/**
 * One-time backfill: sync the `active` flag on all open markets with Gamma API.
 *
 * Problem: ~42K markets stuck with active=false, closed=false because an old
 * expiration audit aggressively set active=false. The periodic Gamma sync
 * self-heals but paginates too slowly for convergence.
 *
 * This script paginates all closed=false markets from Gamma and updates our DB
 * to match. Idempotent — safe to re-run.
 *
 * Usage:
 *   npx tsx packages/indexer/src/scripts/backfill-active-flags.ts
 */

import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/polymarket';
const GAMMA_BASE_URL = 'https://gamma-api.polymarket.com';
const BATCH_SIZE = 100;
const DELAY_MS = 50; // Rate limit between Gamma API calls

interface GammaMarketRow {
  conditionId: string;
  active: boolean;
  closed: boolean;
}

async function fetchGammaMarkets(offset: number): Promise<GammaMarketRow[]> {
  const url = `${GAMMA_BASE_URL}/markets?closed=false&limit=${BATCH_SIZE}&offset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Gamma API error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) return [];

  return data.map((m: Record<string, unknown>) => ({
    conditionId: String(m.conditionId ?? ''),
    active: m.active === true,
    closed: m.closed === true,
  })).filter((m) => m.conditionId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const sql = postgres(DATABASE_URL, { max: 3 });

  console.log('Starting active flag backfill...');
  console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);

  let totalChecked = 0;
  let totalUpdated = 0;
  let offset = 0;
  let batchNum = 0;

  while (true) {
    const gammaMarkets = await fetchGammaMarkets(offset);
    if (gammaMarkets.length === 0) break;

    batchNum++;
    let batchUpdated = 0;

    // Build a map of condition_id (lowercase) → active for this batch
    const activeMap = new Map<string, boolean>();
    for (const gm of gammaMarkets) {
      activeMap.set(gm.conditionId.toLowerCase(), gm.active);
    }

    // Fetch matching markets from our DB (only closed=false)
    const conditionIds = gammaMarkets.map((m) => m.conditionId.toLowerCase());
    const dbMarkets = await sql`
      SELECT id, condition_id, active
      FROM markets
      WHERE closed = false
        AND lower(condition_id) = ANY(${conditionIds})
    `;

    // Update markets where our active flag differs from Gamma
    for (const row of dbMarkets) {
      const gammaActive = activeMap.get((row.condition_id as string).toLowerCase());
      if (gammaActive !== undefined && gammaActive !== row.active) {
        await sql`
          UPDATE markets
          SET active = ${gammaActive}, updated_at = now()
          WHERE id = ${row.id}
        `;
        batchUpdated++;
      }
    }

    totalChecked += gammaMarkets.length;
    totalUpdated += batchUpdated;
    console.log(`Batch ${batchNum}: checked ${gammaMarkets.length}, updated ${batchUpdated} (total: ${totalChecked} checked, ${totalUpdated} updated)`);

    offset += gammaMarkets.length;

    // Rate limit
    await sleep(DELAY_MS);
  }

  console.log(`\nBackfill complete: ${totalChecked} Gamma markets checked, ${totalUpdated} DB markets updated`);

  // Report remaining mismatches
  const remaining = await sql`
    SELECT count(*)::int AS cnt FROM markets WHERE active = false AND closed = false
  `;
  console.log(`Markets still active=false AND closed=false: ${remaining[0]?.cnt ?? '?'}`);

  await sql.end();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

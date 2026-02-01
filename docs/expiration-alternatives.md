# Expiration Handling: Alternative Approaches

The indexer needs to mark markets/events as inactive when their end date passes,
even though Polymarket's Gamma API keeps them `active: true` until official
resolution. This document outlines the approaches considered.

## Option A: Post-sync expiration audit (current implementation)

After each sync cycle completes, run a single `UPDATE` that sets `active = false`
for any row whose end date is in the past.

**Pros:**
- Simple, self-contained SQL
- Runs once per cycle, not per-row
- If Polymarket extends an end date, the next sync restores it before the audit fires
- Clear separation: sync mirrors the API, audit enforces local business rules

**Cons:**
- Brief window (within a single sync cycle) where a just-synced expired item is still `active`
- Adds two queries per cycle (one for markets, one for events)

## Option B: API-level filtering

Add a query-time filter so API responses exclude expired items regardless of the
`active` flag in the database.

```sql
WHERE (end_date_iso IS NULL OR end_date_iso::timestamptz >= NOW())
```

**Pros:**
- Zero extra writes; purely read-time
- No risk of overwriting API data

**Cons:**
- Must be applied to every query that returns markets/events
- Harder to reason about when `active` in the DB doesn't match what the API returns
- Doesn't help consumers that query the DB directly

## Option C: During-upsert override

Override `active` to `false` at upsert time when the end date has already passed.

```typescript
active: market.end_date_iso && new Date(market.end_date_iso) < new Date()
  ? false
  : (market.active ?? true),
```

**Pros:**
- No extra query; piggybacks on the existing upsert
- Expired items are never `active` in the DB, even briefly

**Cons:**
- Mixes API-mirroring logic with business rules in the same upsert
- If the date parse fails or the format changes, the entire upsert could break
- Harder to disable or adjust independently

## Option D: Hybrid (API filter + periodic audit)

Combine Option A and Option B: the API never returns expired items, and a
background audit cleans up the `active` flag periodically.

**Pros:**
- Belt-and-suspenders: expired items never leak to consumers
- DB state eventually matches what the API serves

**Cons:**
- More moving parts
- Redundant for most cases

## Current implementation: Option A with independent timer

We use Option A but with two important refinements discovered during production
deployment:

### 1. Decoupled 60-second audit timer

The original plan was to run the audit after each sync completes. In practice,
the markets sync was timing out (30s `statement_timeout`) when processing ~402k
closed markets, so the post-sync audit never fired. The audit now runs on its
own 60-second `setInterval`, independent of sync. Post-sync audit calls are
kept as an additional safeguard.

### 2. Audit only targets open (unresolved) markets

The audit WHERE clause must include `AND closed = false`. Without this, the
audit deactivated ~372k resolved/closed markets whose end dates were in the
past — which is correct chronologically but wrong semantically. Closed markets
are historical data that should remain visible. The audit should only deactivate
markets that are **open, unresolved, and expired**.

```sql
UPDATE markets
SET active = false, updated_at = NOW()
WHERE active = true
  AND closed = false
  AND end_date_iso IS NOT NULL
  AND end_date_iso::timestamptz < NOW()
```

### 3. Periodic syncs skip closed items

Closed/resolved items are immutable — Polymarket doesn't change them after
resolution. Periodic syncs (every 5 min) only fetch `closed: false` items
(~26k markets, ~7k events). The full pass including closed items only runs
on initial sync with a fresh database.

The lifecycle:
- **Open → closed**: Polymarket resolves a market. The next open-items sync
  picks up `closed: true` from the API and upserts it. That market is now
  closed in our DB, never re-fetched.
- **Open → inactive**: End date passes. The 60-second audit sets `active = false`.
- **Closed items**: Stay in DB forever from previous syncs. Never re-fetched.

## Semantic note: `active` vs `closed`

- `closed = true` means Polymarket officially resolved the market (someone won).
- `active = false` means the market's end date passed but Polymarket hasn't
  resolved it yet. The frontend should filter on `active = true` for the
  homepage/trending.
- These are independent flags. A closed market can be `active = true` (resolved
  markets stay active in Polymarket's API). An expired market is
  `active = false, closed = false`.

## Lessons learned

1. **`postgres-js` via Drizzle's `db.execute` doesn't populate `rowCount`** on
   UPDATE results. Use `RETURNING id` and check `result.rows?.length ??
   result.length` instead.
2. **Drizzle's `sql` template doesn't auto-cast JS arrays to PostgreSQL arrays.**
   `WHERE id = ANY(${ids})` fails with `op ANY/ALL (array) requires array on
   right side`. Use `WHERE id IN (${sql.join(...)})` instead.
3. **Don't sync immutable data repeatedly.** The ~402k closed markets were
   causing 30s statement timeouts every 5-minute cycle, preventing the entire
   sync (and audit) from completing.

---

## Review Findings (Feb 1, 2026)

Use these as action points for the next pass.

### Behavior and correctness
- Stats API counts "active" using `closed = false`, which conflicts with the
  expiration audit that only flips `active`. This can misreport expired-but-not-closed
  rows as active.
- API base URL env vars (`GAMMA_API_URL`, `CLOB_API_URL`, `DATA_API_URL`) are read
  but not wired into client creation in the indexer, so overrides are ignored.
- WebSocket price flush has no in-flight guard; overlapping intervals can lead to
  duplicate `price_history` inserts and stale `outcomePrices` writes.
- Backfill assigns all history points to `tokenIds[0]`, which likely drops history
  for other outcomes unless the upstream endpoint is explicitly single-token.

### Docs/config drift
- README dataset sizes differ from the batch-sync comment; data scale claims are
  inconsistent.
- README references a "web" service in Docker but compose defines only
  `postgres`, `redis`, and `indexer`.
- `.env.example` is missing many config options actually supported by `config.ts`.
- `docker-compose.yml` defines `SYNC_ENABLED` and `SYNC_INTERVAL_MS`, but no code
  references them.

### Operational note
- A local "build/check" can appear hung because `pnpm start` runs a full initial
  sync; there is no `build` script in `@app/indexer`.

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

## Why we chose Option A

Option A provides the best balance of simplicity and correctness. The brief
window where an expired item is still active (at most one sync interval, ~5 min)
is acceptable. If this window becomes a problem, we can layer on Option B as an
additional safeguard without removing the audit.

## Semantic note: `active` vs `closed`

We only set `active = false`. The `closed` flag represents Polymarket's official
resolution status. Conflating "expired" with "resolved" would lose that
distinction. Frontend code should filter on `active = true` rather than relying
solely on `closed = false`.

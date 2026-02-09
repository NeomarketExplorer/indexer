# Bug: Markets stuck with `active=false` when they're live on Polymarket

## Problem

42,518 markets in the indexer database have `active=false, closed=false`, but many of them are actually live and trading on Polymarket. This causes the frontend to hide them — event pages show "No live markets" even when the event has $9M+ volume and 51 active markets.

**Example:** Event 28829 "Who will perform at 2026 Big Game halftime show?" — 51 markets, all with `active=false` in the indexer, but `active=true` on Polymarket's Gamma API.

## Evidence

Indexer says `active=false`:
```
GET http://138.201.57.139:3005/markets/555793
→ active: false, closed: false, volume: > 0
```

Polymarket Gamma says `active=true`:
```
GET https://gamma-api.polymarket.com/markets?slug=will-cardi-b-perform-during-the-super-bowl-lx-halftime-show
→ active: true, closed: false, acceptingOrders: true
```

High-volume markets affected (all `active=false, closed=false` in the indexer):
- 680392: "US government shutdown Saturday?" — $157M volume
- 1269423: "Seahawks vs. Patriots" — $36M volume
- 1144023: "U.S. anti-cartel ground operation in Mexico" — $30M volume
- Plus 42,515 others

## Root Cause (likely)

The indexer was deactivating markets/events based on `end_date`/`end_date_iso` (a midnight timestamp for a date), which is not a reliable "tradable" signal. Many markets remain tradable after the listed end date/time, so this incorrectly flipped `active=false` while `closed=false`.

Additionally, many `active=false, closed=false` rows are actually closed/not-tradable on CLOB/Gamma, but can be missed by a Gamma sync that only pulls `closed=false` items unless we reconcile against the CLOB API.

## What to fix

1. **Find where `active` is set** during market sync/import. It should come from Gamma API's `active` field on the market object.

2. **Make sure the periodic sync updates `active` and `closed`** — not just prices/volume. The sync should do something like:
   ```
   UPDATE markets SET active = gamma_market.active, closed = gamma_market.closed WHERE id = ...
   ```

3. **Backfill existing data** — run a one-time script that fetches all markets from Gamma and updates the `active`/`closed` flags:
   ```
   GET https://gamma-api.polymarket.com/markets?limit=100&offset=0
   → for each market, UPDATE active/closed in the indexer DB
   ```
   Note: Gamma API paginates at 100, so you need to loop through all pages.

4. **Verify after fix:**
   ```bash
   # Should return 0 (or close to 0) if all live markets are correctly marked
   curl "http://138.201.57.139:3005/markets?active=false&closed=false&limit=1"
   # Check pagination.total — should be small (only genuine draft/placeholder markets)
   ```

## Gamma API reference for the sync

```
GET https://gamma-api.polymarket.com/markets?limit=100&offset=0
```

Each market object has:
- `active` (boolean) — whether the market is live
- `closed` (boolean) — whether the market is resolved
- `acceptingOrders` (boolean) — whether the CLOB is accepting orders
- `condition_id` — can be used to match against the indexer's conditionId

You can also filter:
```
GET https://gamma-api.polymarket.com/markets?active=true&limit=100&offset=0
```

## Frontend workaround (already deployed)

We removed the `active` flag check from the frontend's `isPlaceholderMarket()` heuristic so markets with volume or prices are never hidden. But the indexer should still fix the data — other consumers or filters (like `?active=true` on the indexer API) are still broken.

## Status

Fixed in the indexer by:
- Removing end-date-based "expiration audits" that set `active=false`.
- Expanding the periodic CLOB tradability audit to also include open markets even if they are currently `active=false`, so the backlog can self-heal over time.

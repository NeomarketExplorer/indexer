# Frontend Recommendations (Indexer Compatibility)

These are non-code suggestions for the frontend to align with current indexer
semantics and upcoming indexer changes. The frontend is a separate app and is
not modified by the indexer.

## Data Semantics
- Use `active=true` for homepage/live lists. This excludes expired-but-unresolved
  items (active=false, closed=false).
- Optionally add `closed=false` for strictly open markets/events.
- Use `closed=true` for resolved archives.
- Use `active=false` when you want "not live" (expired + resolved).

## Traffic Shaping
- After placing a bet, debounce/merge refresh requests (markets list + market
  detail + stats) to avoid bursts.
- Prefer cached endpoints (they’re already cached server-side) and avoid
  re-fetching within the cache TTL unless the user explicitly refreshes.

## Rate Limit Awareness
- The indexer will be updated to allow higher throughput and bursts, but the
  frontend should still avoid concurrent duplicates (e.g., multiple components
  requesting the same market in parallel).


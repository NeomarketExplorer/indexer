# Indexer Progress Log

## In Progress
- Per-route rate limits (read vs write) based on observed traffic.
- Split remaining roadmap tasks across multiple sessions with tests per step.

## Done
- Token-bucket rate limiter with Redis fallback and burst capacity.
- Higher default rate limit settings with `RATE_LIMIT_BURST`.
- Pagination count casting fixes (total is numeric in list endpoints).
- Price history query uses typed comparison to avoid postgres-js Date bind errors.
- Cascading event audit after market expiration (deactivate events with no active markets).
- Expiration audit indexes (events.end_date, markets.end_date_iso).
- Stats API now counts `active` based on the `active` flag only (no `closed` filter).

## Pending
- Fix CLOB trades auth or disable trades sync until valid key is available.
- Batch price flush writes.
- Composite indexes for list endpoints.
- Financial column migration to numeric(20,8).
- Observability metrics and alerts.

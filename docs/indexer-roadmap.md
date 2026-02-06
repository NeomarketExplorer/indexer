# Indexer Roadmap (Execution Plan)

This roadmap covers indexer-only improvements. Frontend changes are documented
separately in `docs/frontend-recommendations.md`.

## 1) Throughput & Rate Limiting
- Replace fixed-window limiter with token-bucket logic.
- Support Redis-backed limiter for multi-replica deployments.
- Increase default limits and add burst capacity.
- Add per-route limits (read vs write) if needed after observing usage.

## Execution Notes
- Split work into multiple sessions to reduce risk on live deployments.
- Each step should include tests and a production deploy check.

## 2) Reliability
- Fix CLOB trades API auth (valid key) or disable trades sync until resolved.
- Add retry/backoff around external API calls where safe.

## 3) Performance
- Batch WebSocket price flush writes to reduce DB round-trips.
- Add/validate indexes for hot list queries.
- Consider partitioning `price_history` as the table grows.

## 4) Data Integrity
- Migrate financial columns to `numeric(20,8)`.
- Improve backfill for multi-outcome markets when upstream supports it.

## 5) Observability
- Track rate-limit hits, audit counts, sync lag.
- Alerts for stalled sync or audit failures.

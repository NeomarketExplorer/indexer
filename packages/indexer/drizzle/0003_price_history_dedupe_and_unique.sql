-- Ensure price_history is idempotent across backfills, restarts, and multi-replica WS ingestion.
-- 1) Normalize source to non-null
-- 2) Remove existing duplicates (keep the smallest id)
-- 3) Add a unique index for (market_id, token_id, timestamp, source)

-- 1) Normalize / enforce non-null source
UPDATE price_history
SET source = 'clob'
WHERE source IS NULL;

ALTER TABLE price_history
  ALTER COLUMN source SET DEFAULT 'clob';

ALTER TABLE price_history
  ALTER COLUMN source SET NOT NULL;

-- 2) Remove duplicates so the unique index creation cannot fail.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY market_id, token_id, "timestamp", source
      ORDER BY id
    ) AS rn
  FROM price_history
)
DELETE FROM price_history ph
USING ranked r
WHERE ph.id = r.id
  AND r.rn > 1;

-- 3) Enforce uniqueness. (Postgres UNIQUE allows multiple NULLs, but source is now NOT NULL.)
CREATE UNIQUE INDEX IF NOT EXISTS price_history_market_token_ts_source_uidx
  ON price_history (market_id, token_id, "timestamp", source);


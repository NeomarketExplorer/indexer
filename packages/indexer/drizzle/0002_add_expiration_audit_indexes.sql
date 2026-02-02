CREATE INDEX IF NOT EXISTS events_open_end_date_idx
  ON events (end_date)
  WHERE active = true AND closed = false AND end_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS markets_open_end_date_iso_idx
  ON markets (end_date_iso)
  WHERE active = true AND closed = false AND end_date_iso IS NOT NULL;

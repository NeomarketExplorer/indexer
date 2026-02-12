-- Add custom category columns to events table.
-- categories: jsonb array of 2-level slugs (e.g. ["sports", "sports/nba"])
-- gamma_category: Gamma's original category string, preserved for reference.

ALTER TABLE events ADD COLUMN categories jsonb DEFAULT '[]'::jsonb;
ALTER TABLE events ADD COLUMN gamma_category text;

CREATE INDEX events_categories_idx ON events USING gin (categories);
CREATE INDEX events_gamma_category_idx ON events (gamma_category);

-- Backfill gamma_category from the highest-volume market per event
UPDATE events e SET gamma_category = sub.category
FROM (
  SELECT DISTINCT ON (event_id) event_id, category
  FROM markets
  WHERE event_id IS NOT NULL AND category IS NOT NULL
  ORDER BY event_id, volume DESC NULLS LAST
) sub
WHERE e.id = sub.event_id;

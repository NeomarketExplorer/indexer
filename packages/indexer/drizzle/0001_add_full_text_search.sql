-- Add full-text search columns, GIN indexes, and auto-update triggers
-- for markets and events tables

-- Markets: search_vector column
ALTER TABLE markets ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Populate markets search_vector from existing data
-- Weights: A = question, B = description, C = category
UPDATE markets SET search_vector =
  setweight(to_tsvector('english', coalesce(question, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(category, '')), 'C');

-- GIN index on markets search_vector
CREATE INDEX IF NOT EXISTS markets_search_idx ON markets USING GIN (search_vector);

-- Trigger function to auto-update markets search_vector
CREATE OR REPLACE FUNCTION markets_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.question, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.category, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate trigger to be idempotent
DROP TRIGGER IF EXISTS markets_search_vector_trigger ON markets;
CREATE TRIGGER markets_search_vector_trigger
  BEFORE INSERT OR UPDATE OF question, description, category
  ON markets
  FOR EACH ROW
  EXECUTE FUNCTION markets_search_vector_update();

-- Events: search_vector column
ALTER TABLE events ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Populate events search_vector from existing data
-- Weights: A = title, B = description
UPDATE events SET search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B');

-- GIN index on events search_vector
CREATE INDEX IF NOT EXISTS events_search_idx ON events USING GIN (search_vector);

-- Trigger function to auto-update events search_vector
CREATE OR REPLACE FUNCTION events_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate trigger to be idempotent
DROP TRIGGER IF EXISTS events_search_vector_trigger ON events;
CREATE TRIGGER events_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, description
  ON events
  FOR EACH ROW
  EXECUTE FUNCTION events_search_vector_update();

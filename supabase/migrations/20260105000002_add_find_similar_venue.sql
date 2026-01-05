-- Migration: Create find_similar_venue RPC function for fuzzy venue matching
-- CRIT-01: venue-matcher.ts calls this function but it doesn't exist
-- Uses pg_trgm extension for trigram-based similarity matching

-- Enable pg_trgm extension for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create index for faster similarity searches on venue names
CREATE INDEX IF NOT EXISTS idx_venues_name_trgm
ON venues USING gin (name gin_trgm_ops);

-- Create the RPC function for finding similar venues
-- Used by src/features/import/scrapers/venue-matcher.ts:58
CREATE OR REPLACE FUNCTION find_similar_venue(
  search_name TEXT,
  similarity_threshold FLOAT DEFAULT 0.6
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    v.id,
    v.name,
    similarity(v.name, search_name) AS similarity
  FROM venues v
  WHERE similarity(v.name, search_name) >= similarity_threshold
  ORDER BY similarity DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION find_similar_venue(TEXT, FLOAT) TO authenticated;
GRANT EXECUTE ON FUNCTION find_similar_venue(TEXT, FLOAT) TO anon;

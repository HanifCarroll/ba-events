-- Migration: Add venue merge/deduplication functions
-- This enables the venue merge feature on the admin venues page

-- 1. Create table to track dismissed duplicate pairs
-- (must be created before functions that reference it)
CREATE TABLE IF NOT EXISTS dismissed_venue_duplicates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id_1 UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  venue_id_2 UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  dismissed_by UUID REFERENCES auth.users(id),
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure consistent ordering (smaller UUID first)
  CONSTRAINT venue_ids_ordered CHECK (venue_id_1 < venue_id_2),
  -- Unique constraint on the pair
  CONSTRAINT unique_dismissed_pair UNIQUE (venue_id_1, venue_id_2)
);

-- Index for efficient lookups (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_dismissed_duplicates_venues
ON dismissed_venue_duplicates(venue_id_1, venue_id_2);

-- Enable RLS (idempotent)
ALTER TABLE dismissed_venue_duplicates ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policy (for idempotency)
DROP POLICY IF EXISTS admin_dismissed_duplicates ON dismissed_venue_duplicates;
CREATE POLICY admin_dismissed_duplicates ON dismissed_venue_duplicates
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Drop existing functions first (if they have different signatures)
DROP FUNCTION IF EXISTS get_duplicate_venue_candidates(FLOAT);
DROP FUNCTION IF EXISTS get_duplicate_venue_candidates();
DROP FUNCTION IF EXISTS merge_venues(UUID, UUID);

-- 2. Function to find duplicate venue candidates using pg_trgm similarity
CREATE FUNCTION get_duplicate_venue_candidates(
  similarity_threshold FLOAT DEFAULT 0.5
)
RETURNS TABLE (
  venue_id UUID,
  venue_name TEXT,
  venue_neighborhood neighborhood,
  similar_venue_id UUID,
  similar_venue_name TEXT,
  similar_venue_neighborhood neighborhood,
  similarity_score FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    v1.id AS venue_id,
    v1.name AS venue_name,
    v1.neighborhood AS venue_neighborhood,
    v2.id AS similar_venue_id,
    v2.name AS similar_venue_name,
    v2.neighborhood AS similar_venue_neighborhood,
    similarity(v1.name, v2.name)::FLOAT AS similarity_score
  FROM venues v1
  CROSS JOIN venues v2
  WHERE
    v1.id < v2.id  -- Avoid duplicates and self-matches
    AND similarity(v1.name, v2.name) >= similarity_threshold
    -- Exclude pairs that share same parent (intentional relationships)
    AND NOT (v1.parent_id IS NOT NULL AND v2.parent_id IS NOT NULL AND v1.parent_id = v2.parent_id)
    -- Exclude already dismissed pairs
    AND NOT EXISTS (
      SELECT 1 FROM dismissed_venue_duplicates d
      WHERE (d.venue_id_1 = v1.id AND d.venue_id_2 = v2.id)
         OR (d.venue_id_1 = v2.id AND d.venue_id_2 = v1.id)
    )
  ORDER BY similarity_score DESC;
END;
$$;

-- 3. Function to merge two venues (reassign events and delete source)
CREATE FUNCTION merge_venues(
  source_venue_id UUID,
  target_venue_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  events_count INTEGER;
  source_name TEXT;
  target_name TEXT;
BEGIN
  -- Get venue names for result
  SELECT name INTO source_name FROM venues WHERE id = source_venue_id;
  SELECT name INTO target_name FROM venues WHERE id = target_venue_id;

  IF source_name IS NULL THEN
    RAISE EXCEPTION 'Source venue not found: %', source_venue_id;
  END IF;

  IF target_name IS NULL THEN
    RAISE EXCEPTION 'Target venue not found: %', target_venue_id;
  END IF;

  -- Reassign all events from source to target
  UPDATE events
  SET venue_id = target_venue_id
  WHERE venue_id = source_venue_id;

  GET DIAGNOSTICS events_count = ROW_COUNT;

  -- Delete the source venue
  DELETE FROM venues WHERE id = source_venue_id;

  -- Remove any dismissed pairs involving the deleted venue
  DELETE FROM dismissed_venue_duplicates
  WHERE venue_id_1 = source_venue_id OR venue_id_2 = source_venue_id;

  RETURN json_build_object(
    'success', true,
    'events_reassigned', events_count,
    'deleted_venue_id', source_venue_id,
    'deleted_venue_name', source_name,
    'target_venue_id', target_venue_id,
    'target_venue_name', target_name
  );
END;
$$;

-- Grant execute permissions to authenticated users (RLS will handle admin check)
GRANT EXECUTE ON FUNCTION get_duplicate_venue_candidates(FLOAT) TO authenticated;
GRANT EXECUTE ON FUNCTION merge_venues(UUID, UUID) TO authenticated;

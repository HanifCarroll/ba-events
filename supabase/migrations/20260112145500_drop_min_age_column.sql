-- Migration: Drop min_age column from events table
-- The min_age field is not used in the application and has been removed from the codebase.

-- Set search path to include extensions schema for vector type
-- Note: Must use fully-qualified type names for custom types like venue_type and neighborhood
SET LOCAL search_path TO public, extensions;

-- 1. Drop the view first (it depends on min_age column)
DROP VIEW IF EXISTS events_with_venues;

-- 2. Drop the functions (they return min_age and we can't change return type with CREATE OR REPLACE)
DROP FUNCTION IF EXISTS match_events(vector, float, int);
DROP FUNCTION IF EXISTS match_events_with_venues_filtered(vector, float, int, timestamptz, timestamptz, neighborhood, boolean, int, text[]);

-- 3. Drop the min_age column from events table
ALTER TABLE events DROP COLUMN IF EXISTS min_age;

-- 4. Recreate events_with_venues view with the updated schema
CREATE VIEW events_with_venues
WITH (security_invoker = true) AS
SELECT
  e.*,
  v.name AS venue_name,
  v.neighborhood AS venue_neighborhood,
  v.address AS venue_address
FROM events e
LEFT JOIN venues v ON e.venue_id = v.id;

COMMENT ON VIEW events_with_venues IS 'Events joined with venue details. Uses SECURITY INVOKER to respect RLS policies. Recreate this view if columns are added or removed from the events table.';

-- 5. Recreate match_events function without min_age
CREATE FUNCTION match_events(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10
)
RETURNS TABLE (
  id uuid,
  name text,
  description_es text,
  description_en text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_all_day boolean,
  venue_id uuid,
  categories text[],
  price integer,
  is_free boolean,
  image_url text,
  link text,
  ticket_url text,
  source text,
  external_id text,
  status text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    events.id,
    events.name,
    events.description_es,
    events.description_en,
    events.starts_at,
    events.ends_at,
    events.is_all_day,
    events.venue_id,
    events.categories,
    events.price,
    events.is_free,
    events.image_url,
    events.link,
    events.ticket_url,
    events.source,
    events.external_id,
    events.status::text,
    1 - (events.embedding <=> query_embedding) as similarity
  FROM events
  WHERE events.status = 'scheduled'
    AND 1 - (events.embedding <=> query_embedding) > match_threshold
  ORDER BY events.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 6. Recreate match_events_with_venues_filtered function without min_age
CREATE FUNCTION match_events_with_venues_filtered(
  query_embedding vector(1536),
  match_threshold float default 0.2,
  match_count int default 50,
  filter_starts_after timestamptz default null,
  filter_starts_before timestamptz default null,
  filter_neighborhood text default null,
  filter_is_free boolean default null,
  filter_max_price int default null,
  filter_categories text[] default null
)
RETURNS TABLE (
  id uuid,
  name text,
  description_es text,
  description_en text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_all_day boolean,
  venue_id uuid,
  categories text[],
  price integer,
  is_free boolean,
  image_url text,
  link text,
  ticket_url text,
  source text,
  external_id text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  embedding vector(1536),
  venue_name text,
  venue_neighborhood text,
  venue_address text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    e.id,
    e.name,
    e.description_es,
    e.description_en,
    e.starts_at,
    e.ends_at,
    e.is_all_day,
    e.venue_id,
    e.categories,
    e.price,
    e.is_free,
    e.image_url,
    e.link,
    e.ticket_url,
    e.source,
    e.external_id,
    e.status::text,
    e.created_at,
    e.updated_at,
    e.embedding,
    v.name as venue_name,
    v.neighborhood::text as venue_neighborhood,
    v.address as venue_address,
    1 - (e.embedding <=> query_embedding) as similarity
  FROM events e
  LEFT JOIN venues v ON e.venue_id = v.id
  WHERE e.status = 'scheduled'
    AND e.embedding IS NOT NULL
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
    -- Date range filters
    AND (filter_starts_after IS NULL OR e.starts_at >= filter_starts_after)
    AND (filter_starts_before IS NULL OR e.starts_at <= filter_starts_before)
    -- Neighborhood filter
    AND (filter_neighborhood IS NULL OR v.neighborhood::text = filter_neighborhood)
    -- Price filters
    AND (filter_is_free IS NULL OR (filter_is_free = true AND e.is_free = true))
    AND (filter_max_price IS NULL OR e.price IS NULL OR e.price <= filter_max_price)
    -- Categories filter (check if any category overlaps)
    AND (filter_categories IS NULL OR array_length(filter_categories, 1) IS NULL OR e.categories && filter_categories)
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;

COMMENT ON FUNCTION match_events_with_venues_filtered IS
  'Semantic search with server-side filtering. Replaces JavaScript post-processing for better performance.';

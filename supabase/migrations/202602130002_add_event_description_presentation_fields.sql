-- Add structured display and summary description fields for event UX.

SET LOCAL search_path TO public, extensions;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS description_display_es TEXT,
  ADD COLUMN IF NOT EXISTS description_display_en TEXT,
  ADD COLUMN IF NOT EXISTS description_summary_es TEXT,
  ADD COLUMN IF NOT EXISTS description_summary_en TEXT;

COMMENT ON COLUMN events.description_display_es IS
  'Paragraph-preserving Spanish display description (cleaned for UI rendering).';
COMMENT ON COLUMN events.description_display_en IS
  'Paragraph-preserving English display description (cleaned for UI rendering).';
COMMENT ON COLUMN events.description_summary_es IS
  'Short Spanish AI-generated summary for card surfaces.';
COMMENT ON COLUMN events.description_summary_en IS
  'Short English AI-generated summary for card surfaces.';

DROP VIEW IF EXISTS events_with_venues;

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

DROP FUNCTION IF EXISTS match_events(vector, float, int);
DROP FUNCTION IF EXISTS match_events_with_venues_filtered(vector, float, int, timestamptz, timestamptz, text, boolean, int, text[]);

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
  description_display_es text,
  description_display_en text,
  description_summary_es text,
  description_summary_en text,
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
  location_hidden boolean,
  location_tba boolean,
  description_unavailable boolean,
  enrichment_status text,
  enrichment_error text,
  enriched_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    e.id,
    e.name,
    e.description_es,
    e.description_en,
    e.description_display_es,
    e.description_display_en,
    e.description_summary_es,
    e.description_summary_en,
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
    e.location_hidden,
    e.location_tba,
    e.description_unavailable,
    e.enrichment_status::text,
    e.enrichment_error,
    e.enriched_at,
    e.created_at,
    e.updated_at,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM events e
  WHERE e.status = 'scheduled'
    AND e.embedding IS NOT NULL
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;

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
  description_display_es text,
  description_display_en text,
  description_summary_es text,
  description_summary_en text,
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
  location_hidden boolean,
  location_tba boolean,
  description_unavailable boolean,
  enrichment_status text,
  enrichment_error text,
  enriched_at timestamptz,
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
    e.description_display_es,
    e.description_display_en,
    e.description_summary_es,
    e.description_summary_en,
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
    e.location_hidden,
    e.location_tba,
    e.description_unavailable,
    e.enrichment_status::text,
    e.enrichment_error,
    e.enriched_at,
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
    AND (filter_starts_after IS NULL OR e.starts_at >= filter_starts_after)
    AND (filter_starts_before IS NULL OR e.starts_at <= filter_starts_before)
    AND (filter_neighborhood IS NULL OR v.neighborhood::text = filter_neighborhood)
    AND (filter_is_free IS NULL OR (filter_is_free = true AND e.is_free = true))
    AND (filter_max_price IS NULL OR e.price IS NULL OR e.price <= filter_max_price)
    AND (filter_categories IS NULL OR array_length(filter_categories, 1) IS NULL OR e.categories && filter_categories)
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;

COMMENT ON FUNCTION match_events_with_venues_filtered IS
  'Semantic search with server-side filtering and structured display/summary description fields.';

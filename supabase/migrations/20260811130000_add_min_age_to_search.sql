-- Migration: Add min_age to semantic search
-- match_events_with_venues_filtered gains:
--   * a `filter_min_age` argument (the attendee's age): matches events whose
--     min_age restriction is null or <= the filter, i.e. events the user can attend
--   * `min_age` in the returned rows so results carry the age restriction for display
-- Signature changes require DROP + CREATE (cannot ALTER FUNCTION param/return list).

-- Set search path to include extensions schema for the vector type
SET LOCAL search_path TO public, extensions;

DROP FUNCTION IF EXISTS match_events_with_venues_filtered(
  vector,
  float,
  int,
  timestamptz,
  timestamptz,
  text,
  boolean,
  int,
  text[]
);

CREATE FUNCTION match_events_with_venues_filtered(
  query_embedding vector(1536),
  match_threshold float default 0.2,
  match_count int default 50,
  filter_starts_after timestamptz default null,
  filter_starts_before timestamptz default null,
  filter_neighborhood text default null,
  filter_is_free boolean default null,
  filter_max_price int default null,
  filter_categories text[] default null,
  filter_min_age int default null
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
  min_age integer,
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
    e.min_age,
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
    -- Age: events the attendee (aged filter_min_age) is allowed into
    AND (filter_min_age IS NULL OR e.min_age IS NULL OR e.min_age <= filter_min_age)
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;

COMMENT ON FUNCTION match_events_with_venues_filtered IS
  'Semantic search with server-side filtering and chat-safe event result fields. Includes min_age restriction and a filter_min_age attendee-age argument.';

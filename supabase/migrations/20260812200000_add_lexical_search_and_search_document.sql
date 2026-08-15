-- Migration: Lexical (FTS) search + search_document column
--
--   * `events.search_document text` nullable — richer text for FTS. NOT
--     backfilled here (Phase 6 re-embeds and fills it); the lexical RPC and
--     index fall back to `name || ' ' || description_es` so Phase 4 works on
--     today's rows.
--   * GIN index over `to_tsvector('simple', coalesce(search_document, ...))`.
--     `simple` because the corpus is a mix of Spanish and English; neither the
--     `spanish` nor the `english` configuration alone fits.
--   * RPC `lexical_match_events_with_venues` mirroring the semantic RPC's
--     filter surface and chat-safe result shape (incl. `time_tba`), scored by
--     `ts_rank_cd` on full-text match against the search document.

SET LOCAL search_path TO public, extensions;

-- 1. search_document column (nullable; backfilled in Phase 6)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS search_document text;

-- 2. GIN indexes over the tsvectors used for lexical search. Postgres forbids
--    correlated subqueries in index expressions, so the event text and venue
--    name must be indexed separately:
--    * `events_search_document_gin` covers the event text (search_document, or
--      fall back to title + Spanish description).
--    * `venues_name_gin` covers the venue name.
--    `simple` because the corpus mixes es and en. The RPC matches `@@` on a
--    combined tsvector (event text + venue name); that is fine even though only
--    parts of it are individually indexed — the planner uses both indexes.
CREATE INDEX IF NOT EXISTS events_search_document_gin
  ON events
  USING gin (
    to_tsvector(
      'simple',
      coalesce(search_document, name || ' ' || coalesce(description_es, ''))
    )
  );

CREATE INDEX IF NOT EXISTS venues_name_gin
  ON venues
  USING gin (
    to_tsvector('simple', coalesce(name, ''))
  );

-- 3. Lexical search RPC: same filter args and return shape as the semantic
--    RPC, ordering by ts_rank_cd over the FTS tsvector.
CREATE OR REPLACE FUNCTION lexical_match_events_with_venues(
  query text,
  match_count int default 50,
  filter_starts_after timestamptz default null,
  filter_starts_before timestamptz default null,
  filter_neighborhoods text[] default null,
  filter_venue_ids uuid[] default null,
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
  time_tba boolean,
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
    e.time_tba,
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
    ts_rank_cd(
      to_tsvector(
        'simple',
        coalesce(e.search_document, e.name || ' ' || coalesce(e.description_es, '')) || ' ' || coalesce(v.name, '')
      ),
      websearch_to_tsquery('simple', query)
    ) as similarity
  FROM events e
  LEFT JOIN venues v ON e.venue_id = v.id
  WHERE e.status = 'scheduled'
    AND websearch_to_tsquery('simple', query) @@ to_tsvector(
      'simple',
      coalesce(e.search_document, e.name || ' ' || coalesce(e.description_es, '')) || ' ' || coalesce(v.name, '')
    )
    AND (filter_starts_after IS NULL OR e.starts_at >= filter_starts_after)
    AND (filter_starts_before IS NULL OR e.starts_at <= filter_starts_before)
    AND (filter_neighborhoods IS NULL OR array_length(filter_neighborhoods, 1) IS NULL OR v.neighborhood::text = ANY(filter_neighborhoods))
    AND (filter_venue_ids IS NULL OR array_length(filter_venue_ids, 1) IS NULL OR e.venue_id = ANY(filter_venue_ids))
    AND (filter_is_free IS NULL OR (filter_is_free = true AND e.is_free = true))
    AND (filter_max_price IS NULL OR e.price IS NULL OR e.price <= filter_max_price)
    AND (filter_categories IS NULL OR array_length(filter_categories, 1) IS NULL OR e.categories && filter_categories)
    -- Age: events the attendee (aged filter_min_age) is allowed into
    AND (filter_min_age IS NULL OR e.min_age IS NULL OR e.min_age <= filter_min_age)
  ORDER BY
    ts_rank_cd(
      to_tsvector(
        'simple',
        coalesce(e.search_document, e.name || ' ' || coalesce(e.description_es, '')) || ' ' || coalesce(v.name, '')
      ),
      websearch_to_tsquery('simple', query)
    ) DESC,
    e.starts_at ASC
  LIMIT match_count;
$$;

COMMENT ON FUNCTION lexical_match_events_with_venues IS
  'Lexical (full-text) search over the events search document with the same server-side filter surface and chat-safe result fields (incl. time_tba) as the semantic match RPC. Uses to_tsvector(websearch_to_tsquery(..., simple)).';

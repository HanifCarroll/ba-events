-- Expose events.facets on both chat search RPCs so chill/vibe rerank can
-- score hybrid results. The column already exists on events and the
-- events_with_venues view; the RPCs just never returned it.
--
-- Signature is unchanged (args stay the same). RETURNS TABLE grows one
-- column, so DROP + CREATE is required.

SET LOCAL search_path TO public, extensions;

DROP FUNCTION IF EXISTS match_events_with_venues_filtered(
  vector,
  float,
  int,
  timestamptz,
  timestamptz,
  text[],
  uuid[],
  boolean,
  int,
  text[],
  int,
  text[]
);

CREATE FUNCTION match_events_with_venues_filtered(
  query_embedding vector(1536),
  match_threshold float default 0.2,
  match_count int default 50,
  filter_starts_after timestamptz default null,
  filter_starts_before timestamptz default null,
  filter_neighborhoods text[] default null,
  filter_venue_ids uuid[] default null,
  filter_is_free boolean default null,
  filter_max_price int default null,
  filter_categories text[] default null,
  filter_min_age int default null,
  filter_avoid_genres text[] default null
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
  facets jsonb,
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
    e.facets,
    1 - (e.embedding <=> query_embedding) as similarity
  FROM events e
  LEFT JOIN venues v ON e.venue_id = v.id
  WHERE e.status = 'scheduled'
    AND e.embedding IS NOT NULL
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
    AND (filter_starts_after IS NULL OR e.starts_at >= filter_starts_after)
    AND (filter_starts_before IS NULL OR e.starts_at <= filter_starts_before)
    AND (filter_neighborhoods IS NULL OR array_length(filter_neighborhoods, 1) IS NULL OR v.neighborhood::text = ANY(filter_neighborhoods))
    AND (filter_venue_ids IS NULL OR array_length(filter_venue_ids, 1) IS NULL OR e.venue_id = ANY(filter_venue_ids))
    AND (filter_is_free IS NULL OR (filter_is_free = true AND e.is_free = true))
    AND (filter_max_price IS NULL OR e.price IS NULL OR e.price <= filter_max_price)
    AND (filter_categories IS NULL OR array_length(filter_categories, 1) IS NULL OR e.categories && filter_categories)
    AND (filter_min_age IS NULL OR e.min_age IS NULL OR e.min_age <= filter_min_age)
    AND (filter_avoid_genres IS NULL OR array_length(filter_avoid_genres, 1) IS NULL OR NOT (coalesce(e.facets->'genres', '[]'::jsonb) ?| filter_avoid_genres))
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;

COMMENT ON FUNCTION match_events_with_venues_filtered IS
  'Semantic search with server-side filtering and chat-safe event result fields including facets.';

DROP FUNCTION IF EXISTS lexical_match_events_with_venues(
  text, int, timestamptz, timestamptz, text[], uuid[], boolean, int, text[], int, text[]
);

CREATE FUNCTION lexical_match_events_with_venues(
  query text,
  match_count int default 50,
  filter_starts_after timestamptz default null,
  filter_starts_before timestamptz default null,
  filter_neighborhoods text[] default null,
  filter_venue_ids uuid[] default null,
  filter_is_free boolean default null,
  filter_max_price int default null,
  filter_categories text[] default null,
  filter_min_age int default null,
  filter_avoid_genres text[] default null
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
  facets jsonb,
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
    e.facets,
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
    AND (filter_min_age IS NULL OR e.min_age IS NULL OR e.min_age <= filter_min_age)
    AND (filter_avoid_genres IS NULL OR array_length(filter_avoid_genres, 1) IS NULL OR NOT (coalesce(e.facets->'genres', '[]'::jsonb) ?| filter_avoid_genres))
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
  'Lexical (full-text) search with the same server-side filter surface as the semantic match RPC, including facets.';

-- Preserve the current RPC signatures/result fields. Null means no constraint; false means paid-only.
-- Apply this migration before releasing clients that retain an explicit false filter.
set local search_path to public, extensions;

create or replace function match_events_with_venues_filtered(
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
returns table (
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
  image_width integer,
  image_height integer,
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
language sql stable
as $$
  select
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
    e.image_width,
    e.image_height,
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
  from events e
  left join venues v on e.venue_id = v.id
  where e.status = 'scheduled'
    and e.embedding is not null
    and 1 - (e.embedding <=> query_embedding) > match_threshold
    and (filter_starts_after is null or e.starts_at >= filter_starts_after)
    and (filter_starts_before is null or e.starts_at <= filter_starts_before)
    and (filter_neighborhoods is null or array_length(filter_neighborhoods, 1) is null or v.neighborhood::text = any(filter_neighborhoods))
    and (filter_venue_ids is null or array_length(filter_venue_ids, 1) is null or e.venue_id = any(filter_venue_ids))
    and (filter_is_free is null or e.is_free = filter_is_free)
    and (filter_max_price is null or e.price is null or e.price <= filter_max_price)
    and (filter_categories is null or array_length(filter_categories, 1) is null or e.categories && filter_categories)
    and (filter_min_age is null or e.min_age is null or e.min_age <= filter_min_age)
    and (filter_avoid_genres is null or array_length(filter_avoid_genres, 1) is null or not (coalesce(e.facets->'genres', '[]'::jsonb) ?| filter_avoid_genres))
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function lexical_match_events_with_venues(
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
returns table (
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
  image_width integer,
  image_height integer,
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
language sql stable
as $$
  select
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
    e.image_width,
    e.image_height,
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
  from events e
  left join venues v on e.venue_id = v.id
  where e.status = 'scheduled'
    and websearch_to_tsquery('simple', query) @@ to_tsvector(
      'simple',
      coalesce(e.search_document, e.name || ' ' || coalesce(e.description_es, '')) || ' ' || coalesce(v.name, '')
    )
    and (filter_starts_after is null or e.starts_at >= filter_starts_after)
    and (filter_starts_before is null or e.starts_at <= filter_starts_before)
    and (filter_neighborhoods is null or array_length(filter_neighborhoods, 1) is null or v.neighborhood::text = any(filter_neighborhoods))
    and (filter_venue_ids is null or array_length(filter_venue_ids, 1) is null or e.venue_id = any(filter_venue_ids))
    and (filter_is_free is null or e.is_free = filter_is_free)
    and (filter_max_price is null or e.price is null or e.price <= filter_max_price)
    and (filter_categories is null or array_length(filter_categories, 1) is null or e.categories && filter_categories)
    and (filter_min_age is null or e.min_age is null or e.min_age <= filter_min_age)
    and (filter_avoid_genres is null or array_length(filter_avoid_genres, 1) is null or not (coalesce(e.facets->'genres', '[]'::jsonb) ?| filter_avoid_genres))
  order by
    ts_rank_cd(
      to_tsvector(
        'simple',
        coalesce(e.search_document, e.name || ' ' || coalesce(e.description_es, '')) || ' ' || coalesce(v.name, '')
      ),
      websearch_to_tsquery('simple', query)
    ) desc,
    e.starts_at asc
  limit match_count;
$$;

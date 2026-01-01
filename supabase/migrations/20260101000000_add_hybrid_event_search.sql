-- Migration: Add hybrid event search function with server-side filtering
-- This replaces JavaScript post-processing with PostgreSQL filtering for better performance

-- Function to search events by semantic similarity with filters applied server-side
create or replace function match_events_with_venues_filtered(
  query_embedding vector(1536),
  match_threshold float default 0.2,
  match_count int default 50,
  filter_starts_after timestamptz default null,
  filter_starts_before timestamptz default null,
  filter_neighborhood neighborhood default null,
  filter_is_free boolean default null,
  filter_max_price int default null,
  filter_categories text[] default null
)
returns table (
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
  min_age integer,
  image_url text,
  link text,
  ticket_url text,
  source text,
  external_id text,
  status event_status,
  created_at timestamptz,
  updated_at timestamptz,
  embedding vector(1536),
  venue_name text,
  venue_neighborhood neighborhood,
  venue_address text,
  venue_type venue_type,
  similarity float
)
language sql stable
as $$
  select
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
    e.min_age,
    e.image_url,
    e.link,
    e.ticket_url,
    e.source,
    e.external_id,
    e.status,
    e.created_at,
    e.updated_at,
    e.embedding,
    v.name as venue_name,
    v.neighborhood as venue_neighborhood,
    v.address as venue_address,
    v.type as venue_type,
    1 - (e.embedding <=> query_embedding) as similarity
  from events e
  left join venues v on e.venue_id = v.id
  where e.status = 'scheduled'
    and e.embedding is not null
    and 1 - (e.embedding <=> query_embedding) > match_threshold
    -- Date range filters
    and (filter_starts_after is null or e.starts_at >= filter_starts_after)
    and (filter_starts_before is null or e.starts_at <= filter_starts_before)
    -- Neighborhood filter
    and (filter_neighborhood is null or v.neighborhood = filter_neighborhood)
    -- Price filters
    and (filter_is_free is null or (filter_is_free = true and e.is_free = true))
    and (filter_max_price is null or e.price is null or e.price <= filter_max_price)
    -- Categories filter (check if any category overlaps)
    and (filter_categories is null or array_length(filter_categories, 1) is null or e.categories && filter_categories)
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

-- Add comment for documentation
comment on function match_events_with_venues_filtered is
  'Semantic search with server-side filtering. Replaces JavaScript post-processing for better performance.';

-- Enable pgvector extension for semantic search
create extension if not exists vector with schema extensions;

-- All 48 official CABA neighborhoods
create type neighborhood as enum (
  'Agronomía',
  'Almagro',
  'Balvanera',
  'Barracas',
  'Belgrano',
  'Boedo',
  'Caballito',
  'Chacarita',
  'Coghlan',
  'Colegiales',
  'Constitución',
  'Flores',
  'Floresta',
  'La Boca',
  'La Paternal',
  'Liniers',
  'Mataderos',
  'Monte Castro',
  'Monserrat',
  'Nueva Pompeya',
  'Núñez',
  'Palermo',
  'Parque Avellaneda',
  'Parque Chacabuco',
  'Parque Chas',
  'Parque Patricios',
  'Puerto Madero',
  'Recoleta',
  'Retiro',
  'Saavedra',
  'San Cristóbal',
  'San Nicolás',
  'San Telmo',
  'Vélez Sársfield',
  'Versalles',
  'Villa Crespo',
  'Villa del Parque',
  'Villa Devoto',
  'Villa General Mitre',
  'Villa Lugano',
  'Villa Luro',
  'Villa Ortúzar',
  'Villa Pueyrredón',
  'Villa Real',
  'Villa Riachuelo',
  'Villa Santa Rita',
  'Villa Soldati',
  'Villa Urquiza'
);

-- Venue types
create type venue_type as enum (
  'club',
  'bar',
  'theater',
  'gallery',
  'cultural_center',
  'outdoor',
  'restaurant',
  'other'
);

-- Event status
create type event_status as enum (
  'scheduled',
  'canceled',
  'postponed',
  'past',
  'pending_review'
);

-- Venues table
create table venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  neighborhood neighborhood not null,
  address text,
  website text,
  instagram_handle text,
  capacity integer,
  type venue_type not null default 'other',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for venue name search
create index on venues (name);
create index on venues (neighborhood);

-- Events table
create table events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description_es text, -- Spanish description (primary, used for embedding)
  description_en text, -- English description (for display)
  starts_at timestamptz not null,
  ends_at timestamptz,
  is_all_day boolean not null default false,
  time_tba boolean not null default false,
  venue_id uuid references venues(id) on delete set null,
  categories text[] not null default '{}',
  price integer, -- in ARS, null means price not available
  is_free boolean not null default false,
  min_age integer, -- null means all ages
  image_url text,
  link text,
  ticket_url text,
  source text not null,
  external_id text, -- ID from external source for deduplication
  status event_status not null default 'scheduled',
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for vector similarity search
create index on events using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Index for date filtering (most common query pattern)
create index on events (starts_at);

-- Index for category filtering
create index on events using gin (categories);

-- Index for status filtering
create index on events (status);

-- Index for venue lookup
create index on events (venue_id);

-- Updated at trigger function
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply trigger to venues
create trigger venues_updated_at
  before update on venues
  for each row
  execute function update_updated_at();

-- Apply trigger to events
create trigger events_updated_at
  before update on events
  for each row
  execute function update_updated_at();

-- Function to search events by semantic similarity
create or replace function match_events(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10
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
  similarity float
)
language sql stable
as $$
  select
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
    events.min_age,
    events.image_url,
    events.link,
    events.ticket_url,
    events.source,
    events.external_id,
    events.status,
    1 - (events.embedding <=> query_embedding) as similarity
  from events
  where events.status = 'scheduled'
    and 1 - (events.embedding <=> query_embedding) > match_threshold
  order by events.embedding <=> query_embedding
  limit match_count;
$$;

-- Enable pg_trgm extension for fuzzy text matching
create extension if not exists pg_trgm;

-- Index for fuzzy venue name matching
create index idx_venues_name_trgm on venues using gin (name gin_trgm_ops);

-- Function to find similar venues by name (fuzzy matching)
-- Used by src/features/import/scrapers/venue-matcher.ts for venue deduplication
create or replace function find_similar_venue(
  search_name text,
  similarity_threshold float default 0.6
)
returns table (
  id uuid,
  name text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    v.id,
    v.name,
    similarity(v.name, search_name) as similarity
  from venues v
  where similarity(v.name, search_name) >= similarity_threshold
  order by similarity desc
  limit 1;
end;
$$;

-- Helper view: events with venue details
-- Uses security_invoker = true to ensure RLS policies are respected
create view events_with_venues
with (security_invoker = true) as
select
  e.*,
  v.name as venue_name,
  v.neighborhood as venue_neighborhood,
  v.address as venue_address,
  v.type as venue_type
from events e
left join venues v on e.venue_id = v.id;

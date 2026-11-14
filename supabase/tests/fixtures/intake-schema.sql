-- Synthetic disposable Postgres fixture, never a production bootstrap.
create extension vector;
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create type public.event_status as enum('scheduled','canceled','postponed','past','pending_review');
create table public.venues(id uuid primary key default gen_random_uuid(), name text, neighborhood text, address text);
create table public.events(
  id uuid primary key default gen_random_uuid(), name text not null,
  starts_at timestamptz not null, ends_at timestamptz, time_tba boolean not null default false,
  venue_id uuid references public.venues(id), description_es text, description_en text,
  description_display_es text, description_display_en text, description_summary_es text, description_summary_en text,
  categories text[] not null default '{}', price integer, is_free boolean not null default false,
  image_url text, image_width integer, image_height integer, link text, ticket_url text, source text not null, external_id text,
  status public.event_status not null default 'scheduled', embedding vector(1536), search_document text, embedding_version integer,
  enrichment_status text, description_unavailable boolean not null default false, facets jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
grant usage on schema public to service_role;
grant all on public.events, public.venues to service_role;
create function public.synthetic_event_timestamp() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp(); return new; end$$;
create trigger events_updated_at before update on public.events for each row execute function public.synthetic_event_timestamp();
-- Mirrors the production venue_review_queue columns the intake `venue` operation writes (20260108000001_add_scrape_runs.sql).
create table public.venue_review_queue(
  id uuid primary key default gen_random_uuid(), scrape_run_id uuid, source text not null, source_venue_name text not null,
  source_address text, source_coordinates jsonb, source_event_ids uuid[],
  best_match_venue_id uuid references public.venues(id) on delete set null, match_confidence decimal(3,2),
  status text not null default 'pending', reviewed_at timestamptz, reviewed_by uuid,
  final_venue_id uuid references public.venues(id) on delete set null, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
grant all on public.venue_review_queue to service_role;

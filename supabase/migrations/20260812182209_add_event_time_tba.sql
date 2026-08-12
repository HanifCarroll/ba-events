-- Represent a known event date whose start time could not be verified without
-- publishing midnight placeholders as real times.
ALTER TABLE events
ADD COLUMN time_tba boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN events.time_tba IS
  'True when the event date is known but its start time could not be verified.';

-- Repair the twelve future non-all-day records found in the production audit.
-- Six Eventbrite pages expose authoritative detail-page times.
UPDATE events SET
  starts_at = '2026-08-15T18:00:00Z',
  ends_at = '2026-08-15T22:00:00Z',
  time_tba = false,
  external_id = '1991881090963',
  price = 41000,
  is_free = false
WHERE id = 'df5fab18-4ff4-4271-a624-140123e14171';

UPDATE events SET
  starts_at = '2026-08-22T00:30:00Z',
  ends_at = NULL,
  time_tba = false,
  price = 20000,
  is_free = false
WHERE id = '8a9c4689-007f-4ef7-8d25-f4cd726c825e';

UPDATE events SET
  ends_at = NULL,
  time_tba = true,
  price = 25000,
  is_free = false
WHERE id = '29a83015-b50c-4208-a35c-452e5b3d7356';

UPDATE events SET
  starts_at = '2026-08-23T19:00:00Z',
  ends_at = '2026-08-23T20:00:00Z',
  time_tba = false,
  price = 30000,
  is_free = false
WHERE id = '8f9be0b5-d61f-42b4-b031-d98dfbb5b7b9';

UPDATE events SET
  starts_at = '2026-08-29T23:00:00Z',
  ends_at = '2026-08-30T02:30:00Z',
  time_tba = false,
  external_id = '1992766371862',
  price = 6000,
  is_free = false
WHERE id = 'a539d04b-0644-418d-9bb2-28ebbe483b71';

UPDATE events SET
  starts_at = '2026-08-30T17:00:00Z',
  ends_at = '2026-08-30T17:40:00Z',
  time_tba = false,
  price = 45000,
  is_free = false,
  min_age = 12
WHERE id = 'c26c48c9-bcfe-4e1e-a7ef-21fa5e247932';

UPDATE events SET
  starts_at = '2026-09-04T23:00:00Z',
  ends_at = '2026-09-05T00:30:00Z',
  time_tba = false,
  price = 10000,
  is_free = false
WHERE id = 'b3fb3905-12c8-457b-836c-43c689aa2290';

-- Passline supplied only a 00:00-to-00:00 placeholder for La Sata.
UPDATE events SET ends_at = NULL, time_tba = true
WHERE id = '8e4f41d9-d4d0-4f84-9384-2a074f23507d';

-- These were inserted repeatedly because registration URLs were not recognized
-- as carrying Eventbrite IDs. Keep the oldest canonical row and cancel copies.
UPDATE events SET status = 'canceled'
WHERE id IN (
  '699c97a7-4866-41b2-86cb-2d4b449f5b49',
  '5ee3e629-bb76-406f-91e8-d6429d59f8fa',
  '9a85a1b9-249e-47be-a6c9-e0b9874c2f08',
  '36aac057-c369-484b-8040-a0a7953889a6'
);

-- Prevent another importer defect from creating the same source event twice.
CREATE UNIQUE INDEX IF NOT EXISTS events_source_external_id_unique
ON events (source, external_id)
WHERE external_id IS NOT NULL;

-- PostgreSQL views snapshot e.* at creation, so recreate it for time_tba.
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

COMMENT ON VIEW events_with_venues IS
  'Events joined with venue details. Uses SECURITY INVOKER to respect RLS policies. Recreate this view if columns are added or removed from the events table.';

-- Include time_tba in semantic chat results so the model and cards do not
-- reinterpret the stored date anchor as a midnight start.
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
  text[],
  int
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
    v.name AS venue_name,
    v.neighborhood::text AS venue_neighborhood,
    v.address AS venue_address,
    1 - (e.embedding <=> query_embedding) AS similarity
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
    AND (filter_min_age IS NULL OR e.min_age IS NULL OR e.min_age <= filter_min_age)
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;

COMMENT ON FUNCTION match_events_with_venues_filtered IS
  'Semantic search with chat-safe event fields, verified-time state, and attendee-age filtering.';

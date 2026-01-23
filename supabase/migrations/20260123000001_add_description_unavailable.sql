-- Migration: Add description_unavailable field to events table
-- This flag indicates the source page has no description available to scrape.
-- Events marked as description_unavailable won't count toward "Needs Attention".

-- Add the column
ALTER TABLE events ADD COLUMN description_unavailable BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for efficient filtering
CREATE INDEX idx_events_description_unavailable ON events(description_unavailable) WHERE description_unavailable = TRUE;

-- Comment for documentation
COMMENT ON COLUMN events.description_unavailable IS 'True if no description exists on the source page. Excludes event from "missing description" counts.';

-- Update the events_with_venues view to include description_unavailable
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

COMMENT ON VIEW events_with_venues IS 'Events joined with venue details. Uses SECURITY INVOKER to respect RLS policies.';

-- Update the events_admin_list view to include description_unavailable
DROP VIEW IF EXISTS events_admin_list;

CREATE VIEW events_admin_list
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.name,
  e.starts_at,
  e.venue_id,
  e.categories,
  e.source,
  e.status,
  e.link,
  e.created_at,
  e.enrichment_status,
  e.location_tba,
  e.description_unavailable,
  -- Boolean flags instead of full text (saves ~2-10KB per event)
  (e.description_es IS NOT NULL AND e.description_es != '') AS has_description_es,
  (e.description_en IS NOT NULL AND e.description_en != '') AS has_description_en,
  -- Venue fields needed for display
  v.name AS venue_name
FROM events e
LEFT JOIN venues v ON e.venue_id = v.id;

COMMENT ON VIEW events_admin_list IS 'Lightweight view for admin event list. Excludes heavy text columns (descriptions, enrichment data) for better performance.';

-- Update get_event_tab_counts to exclude description_unavailable from missing description count
DROP FUNCTION IF EXISTS get_event_tab_counts(text, uuid, text, boolean, boolean, boolean);

CREATE OR REPLACE FUNCTION get_event_tab_counts(
  p_status text DEFAULT NULL,
  p_venue_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_missing_description boolean DEFAULT false,
  p_missing_venue boolean DEFAULT false,
  p_imported_today boolean DEFAULT false
)
RETURNS TABLE (
  tab_active bigint,
  tab_needs_attention bigint,
  tab_pending_review bigint,
  tab_past bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    -- Active: exclude past and canceled
    COUNT(*) FILTER (WHERE status NOT IN ('past'::event_status, 'canceled'::event_status)) as tab_active,
    -- Needs attention: exclude past/canceled, must have:
    --   - missing description (with link, not marked unavailable) OR
    --   - missing venue (not TBA) OR
    --   - missing link
    COUNT(*) FILTER (WHERE
      status NOT IN ('past'::event_status, 'canceled'::event_status)
      AND (
        (description_es IS NULL AND link IS NOT NULL AND description_unavailable = false)  -- missing description (with link, not unavailable)
        OR (venue_id IS NULL AND location_tba = false) -- missing venue (but not if TBA)
        OR link IS NULL                                 -- missing link
      )
    ) as tab_needs_attention,
    COUNT(*) FILTER (WHERE status = 'pending_review'::event_status) as tab_pending_review,
    COUNT(*) FILTER (WHERE status = 'past'::event_status) as tab_past
  FROM events_with_venues
  WHERE
    -- Status filter (if provided)
    (p_status IS NULL OR status = p_status::event_status)
    -- Venue filter (if provided)
    AND (p_venue_id IS NULL OR venue_id = p_venue_id)
    -- Search filter (if provided)
    AND (p_search IS NULL OR p_search = '' OR name ILIKE '%' || p_search || '%')
    -- Data gap filters
    AND (NOT p_missing_description OR (description_es IS NULL AND link IS NOT NULL AND description_unavailable = false))
    AND (NOT p_missing_venue OR (venue_id IS NULL AND location_tba = false))
    -- Imported today filter
    AND (NOT p_imported_today OR created_at >= date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))
$$;

COMMENT ON FUNCTION get_event_tab_counts(text, uuid, text, boolean, boolean, boolean) IS
'Returns counts for all event tabs (active, needs_attention, pending_review, past) in a single query.
tab_active counts only non-past, non-canceled events.
tab_needs_attention excludes past/canceled and includes events missing description (with link, not marked unavailable), missing venue (excluding TBA), OR missing link.
Accepts optional filter parameters to narrow down the base set of events.
Used by the admin events page for efficient tab badge counts.';

-- Update get_needs_attention_breakdown to exclude description_unavailable
DROP FUNCTION IF EXISTS get_needs_attention_breakdown();

CREATE OR REPLACE FUNCTION get_needs_attention_breakdown()
RETURNS TABLE (
  ready_for_enrichment bigint,
  missing_venue_only bigint,
  enrichment_failed bigint,
  no_link bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    -- Ready for enrichment: pending status, has link, missing desc (not unavailable) or venue
    COUNT(*) FILTER (WHERE
      enrichment_status = 'pending'
      AND link IS NOT NULL
      AND ((description_es IS NULL AND description_unavailable = false) OR venue_id IS NULL)
    ) as ready_for_enrichment,

    -- Missing venue only: completed but missing venue, has link
    COUNT(*) FILTER (WHERE
      enrichment_status = 'completed'
      AND venue_id IS NULL
      AND link IS NOT NULL
    ) as missing_venue_only,

    -- Enrichment failed: previous errors
    COUNT(*) FILTER (WHERE
      enrichment_status = 'failed'
    ) as enrichment_failed,

    -- No link: missing data but can't auto-enrich (excluding description_unavailable)
    COUNT(*) FILTER (WHERE
      link IS NULL
      AND ((description_es IS NULL AND description_unavailable = false) OR venue_id IS NULL)
    ) as no_link
  FROM events
  WHERE status != 'past'::event_status
$$;

COMMENT ON FUNCTION get_needs_attention_breakdown() IS
'Returns breakdown of events needing attention by category:
- ready_for_enrichment: Can be auto-enriched (pending + has link)
- missing_venue_only: Has description but needs venue extraction
- enrichment_failed: Previous enrichment failed, can retry
- no_link: Cannot be auto-enriched, needs manual entry
Events marked as description_unavailable are excluded from description-related counts.';

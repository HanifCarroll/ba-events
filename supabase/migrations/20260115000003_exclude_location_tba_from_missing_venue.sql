-- Migration: Exclude location_tba events from missing venue counts
--
-- Events marked as "venue TBA" should not be counted as missing a venue
-- since they intentionally don't have a venue assigned.

-- Drop the old function
DROP FUNCTION IF EXISTS get_event_tab_counts(text, uuid, text, boolean, boolean, boolean);

-- Create updated function with location_tba exclusion
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
    -- Active: exclude past and cancelled
    COUNT(*) FILTER (WHERE status NOT IN ('past'::event_status, 'cancelled'::event_status)) as tab_active,
    -- Needs attention: exclude past/cancelled, must have missing description (with link) OR missing venue (not TBA) OR missing link
    COUNT(*) FILTER (WHERE
      status NOT IN ('past'::event_status, 'cancelled'::event_status)
      AND (
        (description_es IS NULL AND link IS NOT NULL)  -- missing description (with link)
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
    AND (NOT p_missing_description OR (description_es IS NULL AND link IS NOT NULL))
    AND (NOT p_missing_venue OR (venue_id IS NULL AND location_tba = false))
    -- Imported today filter
    AND (NOT p_imported_today OR created_at >= date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))
$$;

-- Update comment
COMMENT ON FUNCTION get_event_tab_counts(text, uuid, text, boolean, boolean, boolean) IS
'Returns counts for all event tabs (active, needs_attention, pending_review, past) in a single query.
tab_active counts only non-past, non-cancelled events.
tab_needs_attention excludes past/cancelled and includes events missing description (with link), missing venue (excluding TBA), OR missing link.
Accepts optional filter parameters to narrow down the base set of events.
Used by the admin events page for efficient tab badge counts.';

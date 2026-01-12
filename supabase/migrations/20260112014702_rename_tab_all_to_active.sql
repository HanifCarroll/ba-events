-- Migration: Change tab_all to count only active (non-past) events
--
-- The "All Events" tab was renamed to "Active Events", so the count should
-- now exclude past events. We also rename the column from tab_all to tab_active
-- for clarity.

-- Drop the old function
DROP FUNCTION IF EXISTS get_event_tab_counts(text, uuid, text, boolean, boolean, boolean);

-- Create new function with tab_active instead of tab_all
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
    COUNT(*) FILTER (WHERE status != 'past'::event_status) as tab_active,
    COUNT(*) FILTER (WHERE
      status != 'past'::event_status
      AND (
        (description_es IS NULL AND link IS NOT NULL)
        OR venue_id IS NULL
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
    AND (NOT p_missing_venue OR venue_id IS NULL)
    -- Imported today filter
    AND (NOT p_imported_today OR created_at >= date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))
$$;

-- Update comment
COMMENT ON FUNCTION get_event_tab_counts(text, uuid, text, boolean, boolean, boolean) IS
'Returns counts for all event tabs (active, needs_attention, pending_review, past) in a single query.
tab_active counts only non-past events (the "Active Events" tab).
tab_needs_attention now also excludes past events.
Accepts optional filter parameters to narrow down the base set of events.
Used by the admin events page for efficient tab badge counts.';

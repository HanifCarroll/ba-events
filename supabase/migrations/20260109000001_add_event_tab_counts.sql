-- Migration: Add function to efficiently calculate event tab counts
-- This function returns counts for all 4 tabs in a single query, with optional filters applied

CREATE OR REPLACE FUNCTION get_event_tab_counts(
  p_status text DEFAULT NULL,
  p_venue_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_missing_description boolean DEFAULT false,
  p_missing_venue boolean DEFAULT false,
  p_missing_categories boolean DEFAULT false,
  p_imported_today boolean DEFAULT false
)
RETURNS TABLE (
  tab_all bigint,
  tab_needs_attention bigint,
  tab_pending_review bigint,
  tab_past bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*) as tab_all,
    COUNT(*) FILTER (WHERE
      (description_es IS NULL AND link IS NOT NULL)
      OR venue_id IS NULL
      OR categories IS NULL
      OR array_length(categories, 1) IS NULL
      OR array_length(categories, 1) = 0
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
    AND (NOT p_missing_categories OR categories IS NULL OR array_length(categories, 1) IS NULL OR array_length(categories, 1) = 0)
    -- Imported today filter
    AND (NOT p_imported_today OR created_at >= date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))
$$;

-- Add helpful comment
COMMENT ON FUNCTION get_event_tab_counts IS
'Returns counts for all event tabs (all, needs_attention, pending_review, past) in a single query.
Accepts optional filter parameters to narrow down the base set of events.
Used by the admin events page for efficient tab badge counts.';

-- Create index on created_at for imported_today filter performance
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

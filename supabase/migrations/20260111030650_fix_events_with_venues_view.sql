-- Migration: Fix events_with_venues view to include enrichment columns
--
-- The view was created before enrichment_status, enrichment_error, and enriched_at
-- columns were added to the events table. PostgreSQL views with SELECT * don't
-- automatically pick up new columns, so we need to recreate the view.

-- Drop and recreate the view to pick up all current columns from events
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

-- Add a comment explaining the view
COMMENT ON VIEW events_with_venues IS 'Events joined with venue details. Uses SECURITY INVOKER to respect RLS policies. Recreate this view if new columns are added to the events table.';

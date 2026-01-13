-- Migration: Add location_hidden column to events table
--
-- Some event platforms (like Luma) allow hosts to hide the venue address
-- until attendees register. This column tracks when an event has a hidden
-- address so we can display an appropriate message to users.

-- Add the column
ALTER TABLE events ADD COLUMN location_hidden boolean DEFAULT false;

COMMENT ON COLUMN events.location_hidden IS 'True if the event address is hidden until registration (e.g., Luma "Register to See Address")';

-- Recreate the events_with_venues view to include the new column
-- (PostgreSQL views with SELECT * don't automatically pick up new columns)
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

COMMENT ON VIEW events_with_venues IS 'Events joined with venue details. Uses SECURITY INVOKER to respect RLS policies. Recreate this view if new columns are added to the events table.';

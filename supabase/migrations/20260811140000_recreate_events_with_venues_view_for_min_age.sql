-- Migration: Recreate events_with_venues view to include min_age
--
-- 20260811120000_readd_min_age.sql re-added events.min_age and claimed the
-- view "selects e.* and picks up the new column automatically". That is not
-- how PostgreSQL works: a view snapshots its column list at creation time, so
-- columns added to the underlying table afterwards are NOT visible through it.
-- (This repo's own history — 20260111030650, 20260111123144, 20260112130053,
-- 20260112145500, 20260113000000, 20260123000001, 202602130002 — recreates the
-- view for exactly this reason.)
--
-- Queries selecting min_age through the view fail with:
--   column events_with_venues.min_age does not exist
--
-- Recreate the view with the same shape as 202602130002 (e.* plus venue
-- name/neighborhood/address); e.* now includes min_age.

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

COMMENT ON VIEW events_with_venues IS 'Events joined with venue details. Uses SECURITY INVOKER to respect RLS policies. Recreate this view if columns are added or removed from the events table.';

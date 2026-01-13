-- Migration: Fix events_with_venues view security
--
-- The view was flagged by Supabase Security Advisor as having SECURITY DEFINER,
-- which bypasses Row Level Security (RLS) policies. This migration recreates
-- the view with security_invoker = true to ensure RLS is respected.

-- Drop and recreate view with explicit security_invoker = true
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

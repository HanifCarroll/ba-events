-- Migration: Re-add min_age column to events
-- min_age was dropped in 20260112145500_drop_min_age_column.sql (2026-01-12) on the
-- premise that the field was unused. The Eventbrite importer now captures age
-- restrictions from detail pages (e.g. "+18 años"), and EventFilters.minAge already
-- exists in the app types, so the column is being restored.
--
-- The events_with_venues view selects e.* and picks up the new column automatically,
-- so no view recreation is required.

ALTER TABLE events ADD COLUMN min_age integer;

COMMENT ON COLUMN events.min_age IS 'Minimum age required to attend, null means all ages';

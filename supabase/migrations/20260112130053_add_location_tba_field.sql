-- Add location_tba field to events table
-- This flag indicates the venue/location is "To Be Announced" or changes per event instance

ALTER TABLE events ADD COLUMN location_tba BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for efficient filtering of TBA events
CREATE INDEX idx_events_location_tba ON events(location_tba) WHERE location_tba = TRUE;

-- Comment for documentation
COMMENT ON COLUMN events.location_tba IS 'True if the venue/location is TBA or varies per event instance (e.g., rotating dinner locations)';

-- Update the events_with_venues view to include location_tba
DROP VIEW IF EXISTS events_with_venues;

CREATE VIEW events_with_venues AS
SELECT
  e.*,
  v.name AS venue_name,
  v.neighborhood AS venue_neighborhood,
  v.address AS venue_address
FROM events e
LEFT JOIN venues v ON e.venue_id = v.id;

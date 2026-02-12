-- Add venue_enrichment_status column to venues table
-- Tracks whether venue address/neighborhood enrichment is complete or impossible
-- (Separate from address_check_status which tracks address-like name detection)

-- Create the enum type for venue enrichment status
CREATE TYPE venue_enrichment_status AS ENUM (
  'pending',         -- Not yet enriched (default)
  'complete',        -- Address and neighborhood populated
  'cannot_enrich'    -- Reviewed but no data available (e.g., generic location names)
);

-- Add the column with default 'pending'
ALTER TABLE venues
ADD COLUMN venue_enrichment_status venue_enrichment_status NOT NULL DEFAULT 'pending';

-- Add index for filtering by status
CREATE INDEX idx_venues_venue_enrichment_status ON venues(venue_enrichment_status);

-- Comment for documentation
COMMENT ON COLUMN venues.venue_enrichment_status IS 'Status of venue enrichment: pending (needs enrichment), complete (has address/neighborhood), cannot_enrich (reviewed but no data available)';

-- Add parent_id column for venue chains/brands with multiple locations
-- e.g., "Cuervo Cafe" parent with "Cuervo Cafe - Palermo", "Cuervo Cafe - San Telmo" children

ALTER TABLE venues ADD COLUMN parent_id uuid REFERENCES venues(id) ON DELETE SET NULL;

-- Index for efficient parent-child queries
CREATE INDEX idx_venues_parent_id ON venues(parent_id);

-- Documentation
COMMENT ON COLUMN venues.parent_id IS 'References parent venue for chains with multiple locations. NULL for standalone venues or parent venues.';

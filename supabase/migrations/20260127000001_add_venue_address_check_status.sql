-- Add address_check_status column to venues table
-- This allows the AI address detection feature to skip venues that have already been reviewed

-- Create the enum type for address check status
CREATE TYPE address_check_status AS ENUM (
  'pending',        -- Never checked (default for new venues)
  'flagged',        -- AI flagged as address-like, awaiting review
  'confirmed_venue', -- User confirmed this is a valid venue name (not an address)
  'not_flagged'     -- AI checked and determined it's not address-like
);

-- Add the column with default 'pending'
ALTER TABLE venues
ADD COLUMN address_check_status address_check_status NOT NULL DEFAULT 'pending';

-- Add index for filtering by status (we'll often query for 'pending' venues)
CREATE INDEX idx_venues_address_check_status ON venues(address_check_status);

-- Comment for documentation
COMMENT ON COLUMN venues.address_check_status IS 'Status of AI address detection: pending (not checked), flagged (AI thinks it''s an address), confirmed_venue (user confirmed it''s valid), not_flagged (AI determined it''s not an address)';

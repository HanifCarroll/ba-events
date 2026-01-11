-- Migration: Clean up garbage venue records
-- These are AI-generated venue names that slipped through extraction validation
-- Examples: "null The event page explicitly states 'Needs a location'..."

-- Step 1: Identify garbage venues and set their events' venue_id to NULL
-- This preserves the events but removes the bad venue reference
UPDATE events
SET venue_id = NULL
WHERE venue_id IN (
  SELECT id FROM venues
  WHERE
    -- Starts with "null" (AI response leak)
    name ~* '^null\s' OR
    name ~* '^null\.' OR
    name ~* '^null,' OR
    -- Contains AI explanation patterns
    name ~* 'no\s*(specific\s*)?(physical\s*)?venue' OR
    name ~* 'needs\s*a\s*location' OR
    name ~* 'location\s*(field|section)' OR
    name ~* 'the\s*event\s*page' OR
    name ~* 'not\s*been\s*(specified|designated|assigned)' OR
    -- Generic non-venue text
    name ~* '^n/a$' OR
    name ~* '^online\s*event$' OR
    name ~* '^virtual$' OR
    -- Empty or whitespace only
    TRIM(name) = '' OR
    name IS NULL
);

-- Step 2: Delete the garbage venues
-- Due to ON DELETE SET NULL on events.venue_id, this is safe
DELETE FROM venues
WHERE
  -- Starts with "null" (AI response leak)
  name ~* '^null\s' OR
  name ~* '^null\.' OR
  name ~* '^null,' OR
  -- Contains AI explanation patterns
  name ~* 'no\s*(specific\s*)?(physical\s*)?venue' OR
  name ~* 'needs\s*a\s*location' OR
  name ~* 'location\s*(field|section)' OR
  name ~* 'the\s*event\s*page' OR
  name ~* 'not\s*been\s*(specified|designated|assigned)' OR
  -- Generic non-venue text
  name ~* '^n/a$' OR
  name ~* '^online\s*event$' OR
  name ~* '^virtual$' OR
  -- Empty or whitespace only
  TRIM(name) = '' OR
  name IS NULL;

-- Log how many were affected (viewable in migration logs)
DO $$
DECLARE
  deleted_count INTEGER;
BEGIN
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % garbage venue records', deleted_count;
END $$;

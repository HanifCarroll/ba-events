-- Migration: Add 'canceled' enum value to event_status
-- This is step 1 of standardizing on American English spelling
-- Step 2 (updating existing rows) must run in a separate transaction

ALTER TYPE event_status ADD VALUE IF NOT EXISTS 'canceled';

COMMENT ON TYPE event_status IS 'Event status enum. Use canceled (not cancelled) for American English spelling.';

-- Migration: Add missing event_status enum values
-- CRIT-02: TypeScript defines 'past' and 'pending_review' but database enum only has 3 values
-- Both values are actively used throughout the codebase (markPastEvents, moderation, admin tabs)

-- Add missing event_status enum values
-- Note: 'IF NOT EXISTS' is not supported for ADD VALUE, but these don't exist yet
ALTER TYPE event_status ADD VALUE 'past';
ALTER TYPE event_status ADD VALUE 'pending_review';

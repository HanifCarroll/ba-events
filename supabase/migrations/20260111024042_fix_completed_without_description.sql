-- Migration: Fix events marked as completed but missing description
--
-- Issue: 384 Passline events were marked as enrichment_status = 'completed'
-- but have description_es = NULL. This was caused by a bug during the
-- Dec 30, 2025 enrichment run.
--
-- Fix: Reset these events to 'pending' so they can be re-enriched.

UPDATE events
SET
  enrichment_status = 'pending',
  enrichment_error = 'Reset: was marked completed without description (bug fix 2026-01-11)',
  enriched_at = NULL
WHERE
  enrichment_status = 'completed'
  AND description_es IS NULL;

-- Log how many rows were affected (visible in migration output)
DO $$
DECLARE
  affected_count INTEGER;
BEGIN
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE 'Reset % events from completed to pending', affected_count;
END $$;

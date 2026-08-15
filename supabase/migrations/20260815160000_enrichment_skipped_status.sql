-- Add `skipped` to the events enrichment_status enum.
--
-- `skipped` marks rows that are terminal for the server enrichment batch job:
--   - client-side-only sources with no server-side fallback
--   - Passline detail pages behind a Cloudflare challenge / with no description
--   - events whose source page 404/410'd (status is `canceled`)
--
-- Catch-up selection is `.in('enrichment_status', ['pending', 'failed'])`, so
-- `skipped` rows are never reselected — unlike `failed`, which stays retryable.

ALTER TYPE enrichment_status ADD VALUE IF NOT EXISTS 'skipped';

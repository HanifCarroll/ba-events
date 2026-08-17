-- Terminal lifecycle status for guest requests that completed via the
-- deterministic fallback. `completed` remains the success path; a request that
-- finished with a validated plan is indistinguishable at the lifecycle level,
-- so a dedicated status distinguishes fallback-completed requests for
-- diagnostics. The exact fallback reason is persisted in the existing
-- `error_type` column (no new column needed).

ALTER TABLE guest_request_lifecycle
  DROP CONSTRAINT IF EXISTS guest_request_lifecycle_status_check;

ALTER TABLE guest_request_lifecycle
  ADD CONSTRAINT guest_request_lifecycle_status_check
  CHECK (status IN ('started', 'completed', 'completed_with_fallback', 'errored'));

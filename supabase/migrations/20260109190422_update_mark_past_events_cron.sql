-- Update mark-past-events cron job to also include pending_review events
-- Previously only marked 'scheduled' events as past, missing events stuck in pending_review

-- Remove the old job
SELECT cron.unschedule('mark-past-events');

-- Create updated job that includes both scheduled and pending_review events
SELECT cron.schedule(
  'mark-past-events',
  '0 * * * *',  -- Every hour
  $$
    UPDATE events
    SET status = 'past'
    WHERE status IN ('scheduled', 'pending_review')
    AND (
      ends_at < NOW()
      OR (ends_at IS NULL AND starts_at < NOW() - INTERVAL '4 hours')
    )
  $$
);

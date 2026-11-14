-- Date-only events (time TBA or all-day) are stored at midnight Buenos Aires time.
-- The hourly mark-past-events job aged every event without ends_at four hours after
-- starts_at, so a date-only event disappeared from search at 04:00 on its own day.
-- Age date-only events at 04:00 the following day instead (28 hours after midnight),
-- matching the four-hour grace that timed events get after a late-night start.

select cron.unschedule('mark-past-events');

select cron.schedule(
  'mark-past-events',
  '0 * * * *',  -- Every hour
  $$
    update events
    set status = 'past'
    where status in ('scheduled', 'pending_review')
    and (
      ends_at < now()
      or (ends_at is null and not (time_tba or coalesce(is_all_day, false)) and starts_at < now() - interval '4 hours')
      or (ends_at is null and (time_tba or coalesce(is_all_day, false)) and starts_at < now() - interval '28 hours')
    )
  $$
);

-- Restore date-only events the old rule aged early (their day isn't over yet).
-- Intake-protected events only allow scheduled -> past, so bypass the protection
-- trigger for this one correction, as the intake commit function does.
set local ba_events.intake_commit = 'on';

update events
set status = 'scheduled'
where status = 'past'
and ends_at is null
and (time_tba or coalesce(is_all_day, false))
and starts_at >= now() - interval '28 hours';

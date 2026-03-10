alter table if exists public.saved_events
  add column if not exists planned_at timestamptz;

create index if not exists idx_saved_events_user_planned_at
  on public.saved_events (user_id, planned_at desc);

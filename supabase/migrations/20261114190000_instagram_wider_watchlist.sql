-- Wider Instagram watchlist and a precise collection cutoff. The 2026-11-14 posting-frequency scan picked about 160 cultural sources,
-- estimated at about $0.53 a day on Apify Starter with detailedData, so the 100-source ceiling and $1 run limit no longer fit.
alter table public.intake_policy drop constraint intake_policy_max_sources_check;
alter table public.intake_policy add constraint intake_policy_max_sources_check check (max_sources between 1 and 500);
alter table public.intake_policy drop constraint intake_policy_run_cap_usd_check;
alter table public.intake_policy add constraint intake_policy_run_cap_usd_check check (run_cap_usd between 0.01 and 5);
-- The monthly cap is per calendar month. The Apify account's own $19 limit (Starter) blocks any overage on the plan.
update public.intake_policy set max_sources = 200, run_cap_usd = 1.5, monthly_cap_usd = 18 where id;

-- Precise collection cutoff. Apify bills every returned post, and the date cutoff (the day before the last successful
-- run's local date, from 00:00 UTC) asked for about 57 hours a day, so each post was billed 2-3 times.
-- Now: the last successful run's reservation time minus a 2-hour margin, as an ISO UTC timestamp the Actor accepts.
create or replace function public.reserve_instagram_collection() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare p public.intake_policy; r public.intake_runs; d date; used numeric; handles jsonb; since timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('ba-events-instagram-collection'));
  select * into strict p from public.intake_policy where id;
  if not p.collection_enabled then raise exception 'Instagram collection is not enabled'; end if;
  d := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  select * into r from public.intake_runs where local_date = d;
  if found then return to_jsonb(r) || jsonb_build_object('fresh', false); end if;
  select coalesce(sum(coalesce(charged_usd, reserved_usd)), 0) into used
    from public.intake_runs where date_trunc('month', local_date) = date_trunc('month', d);
  if used + p.run_cap_usd > p.monthly_cap_usd then raise exception 'Monthly collection budget exhausted'; end if;
  select jsonb_agg(username order by username) into handles from public.instagram_sources where enabled;
  if coalesce(jsonb_array_length(handles), 0) not between 1 and p.max_sources then raise exception 'Source watchlist exceeds policy or is empty'; end if;
  -- Two hours of overlap before the last successful run was reserved, so a pause (e.g. monthly cap) is caught up; 7 days with none.
  -- Bounded at the old 30-day window; the per-source ceiling and run cap bound a catch-up run's cost.
  select greatest(now() - interval '30 days', coalesce(max(created_at) - interval '2 hours', now() - interval '7 days'))
    into since from public.intake_runs where state = 'succeeded';
  insert into public.intake_runs(local_date, reserved_usd, input)
  values (d, p.run_cap_usd, jsonb_build_object('username', handles, 'resultsLimit', p.posts_per_source,
    'onlyPostsNewerThan', to_char(since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'skipPinnedPosts', false, 'dataDetailLevel', p.data_detail_level, 'includeMusicData', false))
  returning * into r;
  return to_jsonb(r) || jsonb_build_object('fresh', true, 'actor_build', p.actor_build);
end $$;

revoke all on function public.reserve_instagram_collection() from public, anon, authenticated;
grant execute on function public.reserve_instagram_collection() to service_role;

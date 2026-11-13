-- Incremental Instagram collection: fetch only posts newer than the last successful run.
-- posts_per_source becomes a per-account safety ceiling for one run, not a fixed fetch count.
alter table public.intake_policy
  add column data_detail_level text not null default 'detailedData' check (data_detail_level in ('basicData', 'detailedData'));
alter table public.intake_policy alter column posts_per_source set default 20;
alter table public.intake_policy alter column actor_build set default '0.0.679';
-- 0.0.646 returned profile lookup failures for every source on 2026-11-04/05; 0.0.679 was verified on 2026-11-13.
update public.intake_policy set posts_per_source = 20, actor_build = '0.0.679' where id;

create or replace function public.reserve_instagram_collection() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare p public.intake_policy; r public.intake_runs; d date; used numeric; handles jsonb; since date;
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
  -- One day of overlap after the last successful run; never reach back more than 7 days (also the first-run window).
  select greatest(d - 7, coalesce(max(local_date) - 1, d - 7)) into since from public.intake_runs where state = 'succeeded';
  insert into public.intake_runs(local_date, reserved_usd, input)
  values (d, p.run_cap_usd, jsonb_build_object('username', handles, 'resultsLimit', p.posts_per_source,
    'onlyPostsNewerThan', since::text, 'skipPinnedPosts', false, 'dataDetailLevel', p.data_detail_level, 'includeMusicData', false))
  returning * into r;
  return to_jsonb(r) || jsonb_build_object('fresh', true, 'actor_build', p.actor_build);
end $$;

revoke all on function public.reserve_instagram_collection() from public, anon, authenticated;
grant execute on function public.reserve_instagram_collection() to service_role;

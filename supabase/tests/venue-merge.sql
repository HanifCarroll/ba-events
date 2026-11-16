-- Run only in the disposable fixture database via scripts/test-instagram-intake-db.sh, after the fixture and the
-- generated merge.sql from supabase/tests/venue-merge.ts. Ids are the fixture's.
do $$
declare
  sala constant uuid := '00000000-0000-4000-8000-000000000003';
  gone constant uuid[] := array['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']::uuid[];
begin
  if exists(select 1 from public.venues where id = any(gone)) then raise exception 'Source venues were not deleted'; end if;
  -- Three planned events plus one added after the plan.
  if (select count(*) from public.events where venue_id = sala) <> 4 then raise exception 'Events were not repointed to the keeper'; end if;
  -- Execution-time before-images: both source venues with every column, and the event added after the plan.
  -- (Venue 2's updated_at moved when the test corrected and restored its address after the plan.)
  if (select count(*) from public.venue_merge_backup where kind = 'venue' and (row->>'id')::uuid = any(gone) and row->>'address_check_status' = 'flagged') <> 2
    or not exists(select 1 from public.venue_merge_backup where kind = 'venue' and (row->>'id')::uuid = gone[1] and row->>'updated_at' like '2026-02-01%')
    then raise exception 'Source venues not fully backed up'; end if;
  if not exists(select 1 from public.venue_merge_backup where kind = 'event' and row->>'id' = '00000000-0000-4000-8000-000000000105'
    and row->>'venue_id' = gone[1]::text) then raise exception 'Reference added after the plan not backed up'; end if;
  -- The protected event moved too: protect_intake_event_facts would otherwise silently revert its venue_id.
  if (select venue_id from public.events where id = '00000000-0000-4000-8000-000000000103') <> sala then raise exception 'Protected event kept its old venue'; end if;
  if (select name from public.events where id = '00000000-0000-4000-8000-000000000103') <> 'Evento 2' then raise exception 'Protected event changed'; end if;
  if (select website from public.venues where id = sala) <> 'https://sala.example' then raise exception 'Keeper lost a source field'; end if;
  if (select address from public.venues where id = sala) <> 'Calle Ficticia 100' then raise exception 'Keeper address changed'; end if;
  if (select best_match_venue_id from public.venue_review_queue) <> sala or (select final_venue_id from public.venue_review_queue) <> sala then raise exception 'Review queue not repointed'; end if;
  if (select parent_id from public.venues where id = '00000000-0000-4000-8000-000000000006') <> sala then raise exception 'Parent not repointed'; end if;
  if (select payload->>'venue_id' from public.intake_candidates) <> sala::text or (select payload->>'name' from public.intake_candidates) <> 'Evento'
    or (select payload->>'venue_id' from public.intake_candidate_revisions) <> sala::text
    or (select payload->>'venue_id' from public.intake_plans) <> sala::text then raise exception 'Intake payloads not repointed'; end if;
  if exists(select 1 from public.dismissed_venue_duplicates) then raise exception 'Dismissed pair of a source survived'; end if;
  -- Kept apart: same name at different addresses, and a barrio name with no address.
  if (select count(*) from public.venues where public.venue_name_key(name) = 'bar doble') <> 2 then raise exception 'Different addresses were merged'; end if;
  if (select count(*) from public.venues where public.venue_name_key(name) = 'san telmo') <> 2 then raise exception 'Barrio-named venues were merged'; end if;
  if current_setting('ba_events.intake_commit', true) = 'on' then raise exception 'intake_commit leaked out of the merge transaction'; end if;
  -- A source's barrio fills the keeper's empty enum neighborhood.
  if exists(select 1 from public.venues where id = '00000000-0000-4000-8000-000000000010') then raise exception 'Barrio source not merged'; end if;
  if (select neighborhood::text from public.venues where id = '00000000-0000-4000-8000-000000000009') is distinct from 'Palermo'
    then raise exception 'Keeper neighborhood not filled from its source'; end if;
  if (select venue_id from public.events where id = '00000000-0000-4000-8000-000000000106') <> '00000000-0000-4000-8000-000000000009'
    then raise exception 'Barrio source event not repointed'; end if;
  raise notice 'PASS: duplicate merge repoints every reference, keeps protected events, and keeps different places apart';
end $$;

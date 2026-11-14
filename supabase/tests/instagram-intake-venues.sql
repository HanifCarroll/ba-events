-- Run only in the disposable fixture database via scripts/test-instagram-intake-db.sh.
begin;
do $$
declare v uuid; logged uuid; today text := to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD');
begin
  insert into public.venues(name,address,neighborhood) values('Sala Sintética','Av. Ficticia 1234','Almagro') returning id into v;
  -- The intake treats similarity >= 0.85 as the same venue and 0.6-0.85 as ambiguous; the RPC must return the best row with its score.
  if (select id from public.find_similar_venue('Sala Sintetica', 0.6)) <> v then raise exception 'Close name not matched'; end if;
  if (select similarity from public.find_similar_venue('Sala Sintética Bar', 0.6)) >= 0.85 then raise exception 'Longer name reached auto-use'; end if;
  if exists(select 1 from public.find_similar_venue('Teatro Distinto', 0.6)) then raise exception 'Unrelated name matched'; end if;
  -- The evidence row the venue operation writes is accepted as-is.
  insert into public.venue_review_queue(source,source_venue_name,source_address,status,final_venue_id,best_match_venue_id,match_confidence,reviewed_at,notes)
    values('instagram-intake','Sala Sintética','Av. Ficticia 1234','approved',v,null,null,now(),'{"evidence":[{"url":"https://example.org","confirms":"address"}]}') returning id into logged;
  if (select notes::jsonb->'evidence'->0->>'url' from public.venue_review_queue where id=logged) <> 'https://example.org' then raise exception 'Evidence not stored'; end if;
  -- `held` filters future candidates with payload->>date >= today (text compare on ISO dates).
  perform public.submit_intake_candidate('10000000-0000-4000-8000-0000000000a1',0,jsonb_build_object('name','Past','date','2000-01-01'));
  perform public.submit_intake_candidate('10000000-0000-4000-8000-0000000000a2',0,jsonb_build_object('name','Today','date',today));
  perform public.submit_intake_candidate('10000000-0000-4000-8000-0000000000a3',0,jsonb_build_object('name','Later','date','2099-12-31'));
  if (select array_agg(payload->>'name' order by payload->>'date') from public.intake_candidates where payload->>'date' >= today) <> array['Today','Later'] then
    raise exception 'Held date filter wrong'; end if;
  raise notice 'PASS: venue dedupe similarity bands, venue evidence row, held date filter';
end $$;
rollback;

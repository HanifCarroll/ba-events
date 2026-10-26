-- Run only in the disposable fixture database via scripts/test-instagram-intake-db.sh.
begin;
do $$
declare candidate uuid := '10000000-0000-4000-8000-000000000001'; venue uuid := gen_random_uuid();
  observation uuid; run uuid; event uuid := gen_random_uuid(); plan uuid; revised_plan uuid;
  body jsonb; first_receipt jsonb; second_receipt jsonb; reserved jsonb; other uuid;
begin
  if has_table_privilege('anon','public.intake_observations','SELECT') then raise exception 'Evidence exposed to anon'; end if;
  if has_function_privilege('authenticated','public.commit_intake_plan(uuid)','EXECUTE') then raise exception 'Publication exposed'; end if;
  if has_function_privilege('anon','public.protect_intake_event_facts()','EXECUTE') then raise exception 'Trigger exposed'; end if;
  insert into public.instagram_sources(username,authority,enabled,qualification) values('synthetic_venue','venue',true,'Synthetic fixture');
  update public.intake_policy set collection_enabled=true, publishing_enabled=true;
  reserved := public.reserve_instagram_collection(); run := (reserved->>'id')::uuid;
  if not (reserved->>'fresh')::boolean then raise exception 'First reservation not fresh'; end if;
  if (public.reserve_instagram_collection()->>'fresh')::boolean then raise exception 'Duplicate paid run permitted'; end if;
  insert into public.venues(id,name) values(venue,'Synthetic Venue');
  insert into public.intake_observations(run_id,post_id,source_username,post_url,caption,content_hash)
    values(run,'synthetic-post','synthetic_venue','https://www.instagram.com/p/synthetic/','Synthetic evidence',repeat('a',64)) returning id into observation;
  perform public.submit_intake_candidate(candidate,0,'{"name":"Synthetic candidate"}');
  perform public.submit_intake_candidate(candidate,0,'{"name":"Synthetic candidate"}');
  if (select revision from public.intake_candidates where id=candidate) <> 1 then raise exception 'Repeated submission changed revision'; end if;
  begin
    perform public.submit_intake_candidate(candidate,0,'{"name":"Changed candidate"}');
    raise exception 'Expected revision conflict';
  exception when others then if sqlerrm <> 'Candidate revision conflict' then raise; end if; end;
  body := jsonb_build_object('name','Synthetic Jazz','starts_at','2026-11-21T00:00:00Z','time_tba',false,
    'venue_id',venue,'categories',jsonb_build_array('music'),'source','instagram','status','scheduled','is_free',false,
    'embedding',to_jsonb(array_fill(0.1::real,array[1536])),'search_document','Synthetic Jazz','embedding_version',2,
    'enrichment_status','skipped','description_unavailable',true);
  insert into public.intake_plans(candidate_id,revision,action,event_id,payload,evidence,reasons)
    values(candidate,1,'create',event,body,jsonb_build_array(jsonb_build_object('observation_id',observation)),'[]') returning id into plan;
  first_receipt := public.commit_intake_plan(plan);
  second_receipt := public.commit_intake_plan(plan);
  if first_receipt <> second_receipt or (select count(*) from public.events where id=event) <> 1 then raise exception 'Commit not idempotent'; end if;
  perform public.submit_intake_candidate(candidate,1,'{"name":"Rescheduled"}');
  insert into public.intake_plans(candidate_id,revision,action,event_id,expected_event_updated_at,payload,evidence,reasons)
    select candidate,2,'update',event,updated_at,body || '{"starts_at":"2026-12-02T00:00:00Z","status":"canceled"}',
      jsonb_build_array(jsonb_build_object('observation_id',observation,'fields',jsonb_build_array('date','time','status'))),'[]' from public.events where id=event returning id into revised_plan;
  perform public.commit_intake_plan(revised_plan);
  update public.events set starts_at='2026-11-21T00:00:00Z',status='scheduled',name='Stale platform name',search_document='Stale' where id=event;
  if not exists(select 1 from public.events where id=event and status='canceled' and starts_at='2026-12-02T00:00:00Z' and name='Synthetic Jazz' and search_document='Synthetic Jazz') then raise exception 'Platform overwrite was not protected'; end if;
  if (select count(*) from public.events) <> 1 then raise exception 'Reschedule duplicated event'; end if;
  -- A newly observed source revision invalidates uncommitted previews.
  perform public.submit_intake_candidate(candidate,2,'{"name":"Correction"}');
  insert into public.intake_plans(candidate_id,revision,action,event_id,expected_event_updated_at,payload,evidence,reasons)
    select candidate,3,'update',event,updated_at,body,jsonb_build_array(jsonb_build_object('observation_id',observation)),'[]'
    from public.events where id=event returning id into other;
  insert into public.intake_observations(run_id,post_id,source_username,post_url,caption,content_hash,observed_at)
    values(run,'synthetic-post','synthetic_venue','https://www.instagram.com/p/synthetic/','Changed evidence',repeat('b',64),now()+interval '1 second');
  begin
    perform public.commit_intake_plan(other);
    raise exception 'Expected stale evidence rejection';
  exception when others then if sqlerrm <> 'Source changed after review' then raise; end if; end;
  if (select receipt from public.intake_plans where id=other) is not null then raise exception 'Failed commit left a receipt'; end if;
  raise notice 'PASS: permissions, budget reservation, revisions, idempotency, stable identity, stale evidence, and correction protection';
end $$;
rollback;

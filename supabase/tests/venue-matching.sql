-- Run only in the disposable fixture database via scripts/test-instagram-intake-db.sh.
begin;
do $$
declare v uuid;
begin
  insert into public.venues(name,address) values('Sala' || chr(160) || 'Sintética  - CABA','Calle Ficticia 100') returning id into v;
  insert into public.venues(name) values('Club 1000 Sur');
  insert into public.events(name, starts_at, source, venue_id) values('Evento', now() + interval '1 day', 'luma', v);
  -- find_similar_venue used to fail on every call (it declared float and returned real).
  if (select count(*) from public.find_similar_venue('Sala Sintetica', 0.3)) <> 1 then raise exception 'find_similar_venue returned no row'; end if;
  if (select id from public.find_similar_venue('Sala Sintetica', 0.3)) <> v then raise exception 'find_similar_venue returned the wrong venue'; end if;
  if not has_function_privilege('anon','public.find_similar_venue(text,float)','EXECUTE') then raise exception 'find_similar_venue lost its grant'; end if;
  -- venues_named compares normalized names on both sides, with % and _ as plain characters.
  if (select count(*) from public.venues_named('SALA SINTETICA')) <> 1 then raise exception 'Normalized exact match failed'; end if;
  if (select (venue->>'id')::uuid from public.venues_named('sala sintética - Buenos Aires')) <> v then raise exception 'Suffix match failed'; end if;
  if (select event_count from public.venues_named('Sala Sintética')) <> 1 then raise exception 'Event count wrong'; end if;
  if exists(select 1 from public.venues_named('Club 100_ Sur')) or exists(select 1 from public.venues_named('Club %'))
    then raise exception 'A wildcard matched'; end if;
  if exists(select 1 from public.venues_named(' - ')) then raise exception 'An empty name matched'; end if;
  if has_function_privilege('anon','public.venues_named(text)','EXECUTE') then raise exception 'venues_named exposed to anon'; end if;
  raise notice 'PASS: find_similar_venue returns rows, venues_named normalizes names without wildcards';
end $$;
rollback;

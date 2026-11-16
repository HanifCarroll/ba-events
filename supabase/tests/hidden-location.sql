-- Run only in the disposable fixture database via scripts/test-instagram-intake-db.sh.
begin;
-- A protection row normally comes from a committed plan; this one stands alone.
alter table public.event_intake_protection alter column plan_id drop not null;
alter table public.event_intake_protection drop constraint event_intake_protection_plan_id_fkey;
do $$
declare v uuid; e uuid;
begin
  insert into public.venues(name) values('Sala Sintética Oculta') returning id into v;
  insert into public.events(name, starts_at, source, venue_id, location_hidden)
    values('Hidden on insert', now() + interval '1 day', 'luma', v, true) returning id into e;
  if (select venue_id from public.events where id = e) is not null then raise exception 'Insert kept a venue on a hidden event'; end if;
  update public.events set location_hidden = false, venue_id = v where id = e;
  if (select venue_id from public.events where id = e) <> v then raise exception 'Public event lost its venue'; end if;
  update public.events set location_hidden = true where id = e;
  if (select venue_id from public.events where id = e) is not null then raise exception 'Hiding kept the venue'; end if;
  update public.events set venue_id = v where id = e;
  if (select venue_id from public.events where id = e) is not null then raise exception 'Venue attached to a hidden event'; end if;
  -- Intake protection restores a protected venue_id; the guard still wins.
  update public.events set location_hidden = false, venue_id = v where id = e;
  insert into public.event_intake_protection(event_id, fields, authority, observed_at) values(e, array['venue_id'], 1, now());
  update public.events set location_hidden = true, venue_id = null where id = e;
  if (select venue_id from public.events where id = e) is not null then raise exception 'Intake protection restored a venue on a hidden event'; end if;
  raise notice 'PASS: hidden events never keep a venue';
end $$;
rollback;

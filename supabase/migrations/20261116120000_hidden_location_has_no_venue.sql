-- An event whose address is shared only after registration (location_hidden) never
-- has a venue. Guests-only Luma events once got fake venues ("Buenos Aires, Argentina")
-- from their obfuscated city. Every writer (importers, enrichment, venue review and
-- merges, intake, manual SQL) passes through this trigger, so the rule lives in one place.
-- Named zz_ so it fires after protect_intake_event_facts (same-timing triggers fire in
-- name order), and a restored venue_id cannot slip past it.
-- Idempotent: production migrations are applied by hand and a retry must succeed.

create or replace function public.hidden_location_has_no_venue() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.location_hidden and new.venue_id is not null then new.venue_id := null; end if;
  return new;
end $$;

drop trigger if exists zz_hidden_location_has_no_venue on public.events;
create trigger zz_hidden_location_has_no_venue before insert or update on public.events
for each row execute function public.hidden_location_has_no_venue();

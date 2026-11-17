-- Venue matching for the importers (Luma, Meetup, BA Tourism) and the intake preview. Safe to apply twice and before
-- the code that uses it deploys: it replaces one function body with the same signature and adds new objects.
-- 1. find_similar_venue declared `similarity float` but returned pg_trgm's real, so every call failed ("structure of query
--    does not match function result type") and the importers never got a fuzzy match. Same name, arguments and grants.
create or replace function public.find_similar_venue(search_name text, similarity_threshold float default 0.6)
returns table (id uuid, name text, similarity float)
language sql stable set search_path = public, extensions as $$
  select v.id, v.name, similarity(v.name, search_name)::float
  from public.venues v
  where similarity(v.name, search_name) >= similarity_threshold
  order by 3 desc, v.created_at, v.id
  limit 1
$$;
grant execute on function public.find_similar_venue(text, float) to authenticated;
grant execute on function public.find_similar_venue(text, float) to anon;

-- 2. The name two venues must share to count as the same name: case, accents, every kind of whitespace (non-breaking
--    spaces included) and punctuation folded, trailing "- Buenos Aires", "- CABA" and "- Argentina" dropped.
--    `venueNameKey` in src/features/import/core/venue-identity.ts is the same rule; a test keeps the fold table equal.
create or replace function public.venue_name_key(p_name text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(
    lower(translate(normalize(p_name, nfc), 'ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÑñÇçÝýÿ–—' || chr(160), 'aaaaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuunnccyyy-- ')),
    '[^a-z0-9-]+', ' ', 'g'), '( *- *(buenos aires|caba|argentina))+[ -]*$', ''), '[^a-z0-9]+', ' ', 'g'))
$$;

-- 3. Every venue with the same name key, plus its event count, for the importers' exact match. No ilike, so a % or _
--    in a name is a plain character. The caller picks among several (same street and number, then the merge keeper).
create or replace function public.venues_named(p_name text)
returns table (venue jsonb, event_count bigint)
language sql stable set search_path = public as $$
  select to_jsonb(v), (select count(*) from public.events e where e.venue_id = v.id)
  from public.venues v
  where public.venue_name_key(v.name) = public.venue_name_key(p_name) and public.venue_name_key(p_name) <> ''
  order by v.created_at, v.id
$$;
revoke all on function public.venues_named(text) from public, anon, authenticated;
grant execute on function public.venues_named(text) to service_role;

-- 4. Before-images the duplicate-venue merge saves at execution time (scripts/venue-duplicates.ts writes merge.sql and
--    undo.sql). One row per changed record; `merged_at` groups a run. Service role only.
create table if not exists public.venue_merge_backup(merged_at timestamptz not null, kind text not null, row jsonb not null);
alter table public.venue_merge_backup enable row level security;
revoke all on public.venue_merge_backup from public, anon, authenticated;
grant all on public.venue_merge_backup to service_role;

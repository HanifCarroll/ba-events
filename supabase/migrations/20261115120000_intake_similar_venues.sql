-- Venue candidates for the Instagram intake `venue` operation. find_similar_venue declares float but returns
-- pg_trgm's real, so every call errors and the importers' matcher reads that as "no match"; this function casts.
-- It is separate so the importers' behavior doesn't change with this release.
create or replace function public.intake_similar_venues(p_name text, p_threshold float default 0.6)
returns table (id uuid, name text, address text, neighborhood text, similarity float)
language sql stable security invoker set search_path = public, extensions as $$
  select v.id, v.name, v.address, v.neighborhood::text,
    case when lower(v.name) = lower(p_name) then 1.0::float else similarity(v.name, p_name)::float end
  from public.venues v
  where lower(v.name) = lower(p_name) or similarity(v.name, p_name) >= p_threshold
  -- No limit: the caller must see every lookalike above the threshold, or an unlisted one could be cleared past.
  order by 5 desc, v.name
$$;
revoke all on function public.intake_similar_venues(text, float) from public, anon, authenticated;
grant execute on function public.intake_similar_venues(text, float) to service_role;

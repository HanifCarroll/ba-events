-- Migration: Fix ambiguous request_count reference in check_rate_limit
--
-- The function declares `RETURNS TABLE(... request_count integer ...)`, which
-- creates an OUT parameter named `request_count` that acts as a PL/pgSQL
-- variable. The unqualified `RETURNING request_count` in the INSERT ... ON
-- CONFLICT clause was therefore ambiguous between that OUT variable and the
-- rate_limit_windows.request_count column, raising:
--   42702: column reference "request_count" is ambiguous
-- (the app fails open: check_rate_limit catches and logs "rate limit
-- unavailable ... Allowing requests", so rate limiting silently did nothing).
--
-- Qualify the RETURNING column with the row alias so it resolves to the
-- table column.

create or replace function public.check_rate_limit(
  p_scope text,
  p_identifier_hash text,
  p_max_requests integer,
  p_window_seconds integer
)
returns table (
  success boolean,
  remaining integer,
  reset bigint,
  request_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_window_start timestamptz;
  next_window_start timestamptz;
  current_count integer;
begin
  if coalesce(trim(p_scope), '') = '' then
    raise exception 'p_scope is required';
  end if;

  if coalesce(trim(p_identifier_hash), '') = '' then
    raise exception 'p_identifier_hash is required';
  end if;

  if p_max_requests <= 0 then
    raise exception 'p_max_requests must be greater than zero';
  end if;

  if p_window_seconds <= 0 then
    raise exception 'p_window_seconds must be greater than zero';
  end if;

  current_window_start := to_timestamp(
    floor(extract(epoch from timezone('utc', now())) / p_window_seconds) * p_window_seconds
  );
  next_window_start := current_window_start + make_interval(secs => p_window_seconds);

  insert into public.rate_limit_windows as rl (
    scope,
    identifier_hash,
    window_starts_at,
    request_count,
    created_at,
    updated_at
  )
  values (
    p_scope,
    p_identifier_hash,
    current_window_start,
    1,
    timezone('utc', now()),
    timezone('utc', now())
  )
  on conflict (scope, identifier_hash, window_starts_at)
  do update
    set request_count = rl.request_count + 1,
        updated_at = timezone('utc', now())
  returning rl.request_count into current_count;

  delete from public.rate_limit_windows
  where updated_at < timezone('utc', now()) - interval '7 days';

  success := current_count <= p_max_requests;
  remaining := greatest(p_max_requests - current_count, 0);
  reset := (extract(epoch from next_window_start) * 1000)::bigint;
  request_count := current_count;

  return next;
end;
$$;

revoke all on function public.check_rate_limit(text, text, integer, integer) from public;
revoke all on function public.check_rate_limit(text, text, integer, integer) from anon;
revoke all on function public.check_rate_limit(text, text, integer, integer) from authenticated;
grant execute on function public.check_rate_limit(text, text, integer, integer) to service_role;

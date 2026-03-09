create table public.rate_limit_windows (
  scope text not null,
  identifier_hash text not null,
  window_starts_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (scope, identifier_hash, window_starts_at)
);

create index rate_limit_windows_updated_at_idx
  on public.rate_limit_windows (updated_at desc);

alter table public.rate_limit_windows enable row level security;

revoke all on public.rate_limit_windows from anon;
revoke all on public.rate_limit_windows from authenticated;

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
  returning request_count into current_count;

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

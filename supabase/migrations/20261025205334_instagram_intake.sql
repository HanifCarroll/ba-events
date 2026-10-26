-- Private operator intake. No public API role can read evidence or publish.
create table public.intake_policy (
  id boolean primary key default true check (id),
  publishing_enabled boolean not null default false,
  collection_enabled boolean not null default false,
  max_sources integer not null default 20 check (max_sources between 1 and 100),
  posts_per_source integer not null default 5 check (posts_per_source between 1 and 20),
  run_cap_usd numeric not null default 0.35 check (run_cap_usd between 0.01 and 1),
  monthly_cap_usd numeric not null default 5 check (monthly_cap_usd between 0.01 and 100),
  actor_build text not null default '0.0.646'
);
insert into public.intake_policy(id) values (true);

create table public.instagram_sources (
  username text primary key check (username ~ '^[a-z0-9_.]{1,30}$'),
  authority text not null check (authority in ('organizer', 'venue', 'curator')),
  enabled boolean not null default false,
  qualification text not null,
  created_at timestamptz not null default now()
);
create table public.intake_runs (
  id uuid primary key default gen_random_uuid(),
  local_date date not null unique,
  state text not null default 'reserved' check (state in ('reserved', 'started', 'succeeded', 'failed', 'unknown')),
  reserved_usd numeric not null check (reserved_usd > 0),
  charged_usd numeric check (charged_usd >= 0),
  apify_run_id text unique,
  dataset_id text,
  input jsonb not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create table public.intake_observations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.intake_runs(id),
  post_id text not null,
  source_username text not null references public.instagram_sources(username),
  post_url text not null,
  caption text not null,
  published_at timestamptz,
  observed_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  media_urls jsonb not null default '[]',
  reviewed_at timestamptz,
  review_note text,
  unique (run_id, post_id, content_hash)
);
create index intake_observations_review on public.intake_observations(observed_at) where reviewed_at is null;
create index intake_observations_source on public.intake_observations(source_username, post_id);
create table public.intake_media (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.intake_observations(id),
  position integer not null check (position >= 0),
  object_key text not null,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  unique (observation_id, position)
);
create table public.intake_candidates (
  id uuid primary key,
  revision integer not null check (revision > 0),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
create table public.intake_candidate_revisions (
  candidate_id uuid not null references public.intake_candidates(id),
  revision integer not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key(candidate_id, revision)
);
create table public.intake_plans (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.intake_candidates(id),
  revision integer not null,
  action text not null check (action in ('create', 'update', 'link', 'held')),
  event_id uuid not null,
  expected_event_updated_at timestamptz,
  artwork_media_id uuid references public.intake_media(id),
  payload jsonb not null,
  evidence jsonb not null,
  reasons jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  receipt jsonb
);
create table public.event_source_evidence (
  event_id uuid not null references public.events(id),
  candidate_id uuid not null references public.intake_candidates(id),
  observation_id uuid not null references public.intake_observations(id),
  revision integer not null,
  primary key (event_id, candidate_id, observation_id)
);
create index event_source_evidence_candidate on public.event_source_evidence(candidate_id);
create index event_source_evidence_observation on public.event_source_evidence(observation_id);
create table public.event_intake_protection (
  event_id uuid primary key references public.events(id) on delete cascade,
  fields text[] not null,
  plan_id uuid not null references public.intake_plans(id),
  authority integer not null,
  observed_at timestamptz not null
);

do $$ declare t text; begin
  foreach t in array array['intake_policy', 'instagram_sources', 'intake_runs', 'intake_observations', 'intake_media', 'intake_candidates', 'intake_candidate_revisions', 'intake_plans', 'event_source_evidence', 'event_intake_protection'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('instagram-evidence', 'instagram-evidence', false, 10485760, array['image/jpeg','image/png','image/webp']),
       ('event-artwork', 'event-artwork', true, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create function public.reserve_instagram_collection() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare p public.intake_policy; r public.intake_runs; d date; used numeric; handles jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('ba-events-instagram-collection'));
  select * into strict p from public.intake_policy where id;
  if not p.collection_enabled then raise exception 'Instagram collection is not enabled'; end if;
  d := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  select * into r from public.intake_runs where local_date = d;
  if found then return to_jsonb(r) || jsonb_build_object('fresh', false); end if;
  select coalesce(sum(coalesce(charged_usd, reserved_usd)), 0) into used
    from public.intake_runs where date_trunc('month', local_date) = date_trunc('month', d);
  if used + p.run_cap_usd > p.monthly_cap_usd then raise exception 'Monthly collection budget exhausted'; end if;
  select jsonb_agg(username order by username) into handles from public.instagram_sources where enabled;
  if coalesce(jsonb_array_length(handles), 0) not between 1 and p.max_sources then raise exception 'Source watchlist exceeds policy or is empty'; end if;
  insert into public.intake_runs(local_date, reserved_usd, input)
  values (d, p.run_cap_usd, jsonb_build_object('username', handles, 'resultsLimit', p.posts_per_source,
    'onlyPostsNewerThan', (d - 30)::text, 'skipPinnedPosts', false, 'dataDetailLevel', 'detailedData', 'includeMusicData', false))
  returning * into r;
  return to_jsonb(r) || jsonb_build_object('fresh', true, 'actor_build', p.actor_build);
end $$;

create function public.submit_intake_candidate(p_id uuid, p_expected_revision integer, p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare c public.intake_candidates; n integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_id::text));
  select * into c from public.intake_candidates where id = p_id for update;
  if found and c.payload = p_payload then return to_jsonb(c); end if;
  if coalesce(c.revision, 0) <> p_expected_revision then raise exception 'Candidate revision conflict'; end if;
  n := p_expected_revision + 1;
  insert into public.intake_candidates(id, revision, payload) values(p_id, n, p_payload)
    on conflict(id) do update set revision = n, payload = excluded.payload, updated_at = now()
    returning * into c;
  insert into public.intake_candidate_revisions(candidate_id, revision, payload) values(p_id, n, p_payload);
  return to_jsonb(c);
end $$;

-- All existing source importers and enrichment writers pass through this trigger.
-- Only this transaction's commit function can replace accepted corrections.
create function public.protect_intake_event_facts() returns trigger
language plpgsql security definer set search_path = '' as $$
declare protected text[]; k text; row_data jsonb; changed boolean := false;
begin
  if current_setting('ba_events.intake_commit', true) = 'on' then return new; end if;
  select fields into protected from public.event_intake_protection where event_id = old.id;
  if protected is null then return new; end if;
  row_data := to_jsonb(new);
  foreach k in array protected loop
    if k='status' and new.status='past' and old.status='scheduled' and old.starts_at<now() then continue; end if;
    if row_data->k is distinct from to_jsonb(old)->k then
      row_data := jsonb_set(row_data, array[k], to_jsonb(old)->k); changed := true;
    end if;
  end loop;
  if changed then
    foreach k in array array['embedding','embedding_version','search_document'] loop
      row_data := jsonb_set(row_data, array[k], to_jsonb(old)->k);
    end loop;
  end if;
  new := jsonb_populate_record(new, row_data);
  return new;
end $$;
create trigger protect_intake_event_facts before update on public.events
for each row execute function public.protect_intake_event_facts();

create function public.check_intake_plan(p_plan_id uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare p public.intake_plans; c public.intake_candidates; updated timestamptz;
begin
  select * into strict p from public.intake_plans where id=p_plan_id;
  if p.receipt is not null then return true; end if;
  if not (select publishing_enabled from public.intake_policy where id) then raise exception 'Publishing is not enabled'; end if;
  if p.action='held' or p.expires_at < now() then raise exception 'Plan is held or expired'; end if;
  select * into strict c from public.intake_candidates where id=p.candidate_id;
  if c.revision <> p.revision then raise exception 'Candidate changed after preview'; end if;
  if p.action <> 'create' then
    select updated_at into updated from public.events where id=p.event_id;
    if not found or updated is distinct from p.expected_event_updated_at then raise exception 'Catalog changed after preview'; end if;
  end if;
  if exists(select 1 from public.event_source_evidence where candidate_id=p.candidate_id and event_id<>p.event_id) then
    raise exception 'Candidate is already associated with another event';
  end if;
  if exists(select 1 from jsonb_array_elements(p.evidence) x
    join public.intake_observations o on o.id=(x->>'observation_id')::uuid
    where exists(select 1 from public.intake_observations newer where newer.post_id=o.post_id and newer.observed_at>o.observed_at)) then
    raise exception 'Source changed after review';
  end if;
  if exists(select 1 from jsonb_array_elements(p.evidence) x
    left join public.intake_observations o on o.id=(x->>'observation_id')::uuid where o.id is null) then
    raise exception 'Evidence is missing';
  end if;
  return true;
end $$;

create function public.commit_intake_plan(p_plan_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare p public.intake_plans; c public.intake_candidates; e public.events; previous public.events;
  ev jsonb; protection public.event_intake_protection; level integer; observed timestamptz; result_receipt jsonb; fact text;
begin
  perform pg_advisory_xact_lock(hashtext('ba-events-intake-publication'));
  select * into strict p from public.intake_plans where id = p_plan_id for update;
  if p.receipt is not null then return p.receipt; end if;
  perform public.check_intake_plan(p_plan_id);
  if not (select publishing_enabled from public.intake_policy where id) then raise exception 'Publishing is not enabled'; end if;
  if p.action = 'held' or p.expires_at < now() then raise exception 'Plan is held or expired'; end if;
  select * into strict c from public.intake_candidates where id = p.candidate_id for update;
  if c.revision <> p.revision then raise exception 'Candidate changed after preview'; end if;
  if exists(select 1 from public.intake_plans where candidate_id=p.candidate_id and revision=p.revision and receipt is not null) then
    raise exception 'Candidate revision already committed through another plan';
  end if;
  select * into previous from public.events where id = p.event_id for update;
  if p.action <> 'create' and (previous.id is null or previous.updated_at is distinct from p.expected_event_updated_at) then raise exception 'Catalog changed after preview'; end if;
  if p.action = 'create' and exists(select 1 from public.events where
    venue_id = (p.payload->>'venue_id')::uuid and
    (starts_at at time zone 'America/Argentina/Buenos_Aires')::date = ((p.payload->>'starts_at')::timestamptz at time zone 'America/Argentina/Buenos_Aires')::date and
    starts_at = (p.payload->>'starts_at')::timestamptz and
    (lower(name) = lower(p.payload->>'name') or ticket_url = nullif(p.payload->>'ticket_url', ''))) then
    raise exception 'A matching event appeared after preview';
  end if;
  select max(case s.authority when 'curator' then 1 else 2 end), max(o.observed_at)
    into level, observed from jsonb_array_elements(p.evidence) x
    join public.intake_observations o on o.id = (x->>'observation_id')::uuid
    join public.instagram_sources s on s.username = o.source_username;
  if level is null then raise exception 'Retained evidence is required'; end if;
  e := jsonb_populate_record(null::public.events, p.payload);
  if p.action = 'update' then
    select * into protection from public.event_intake_protection where event_id=p.event_id;
    if level < 2 or (protection.event_id is not null and (level < protection.authority or observed < protection.observed_at)) then
      raise exception 'Correction needs current organizer or venue evidence';
    end if;
    for fact in select field from (values
      ('status', previous.status is distinct from e.status),
      ('date', previous.starts_at is distinct from e.starts_at),
      ('time', previous.starts_at is distinct from e.starts_at and not e.time_tba),
      ('venue', previous.venue_id is distinct from e.venue_id),
      ('price', previous.price is distinct from e.price or previous.is_free is distinct from e.is_free)
    ) changed(field, needs_evidence) where needs_evidence loop
      if not exists(select 1 from jsonb_array_elements(p.evidence) x
        join public.intake_observations o on o.id=(x->>'observation_id')::uuid
        join public.instagram_sources s on s.username=o.source_username
        where s.authority in ('venue','organizer') and x->'fields' ? fact and
          (protection.observed_at is null or o.observed_at >= protection.observed_at)) then
        raise exception 'Correction field lacks current direct evidence: %', fact;
      end if;
    end loop;
  end if;
  if p.action <> 'link' and (e.embedding is null or e.search_document is null) then raise exception 'Search preparation is required'; end if;
  if p.action = 'create' then
    insert into public.events(id, name, starts_at, ends_at, time_tba, venue_id, description_es, description_en,
      description_display_es, description_display_en, description_summary_es, description_summary_en,
      categories, price, is_free, image_url, image_width, image_height, link, ticket_url, source, external_id, status,
      embedding, search_document, embedding_version, enrichment_status, description_unavailable)
    values(p.event_id, e.name, e.starts_at, null, e.time_tba, e.venue_id, e.description_es, e.description_en,
      e.description_display_es, e.description_display_en, e.description_summary_es, e.description_summary_en,
      e.categories, e.price, e.is_free, e.image_url, e.image_width, e.image_height, e.link, e.ticket_url, 'instagram', p.candidate_id::text, e.status,
      e.embedding, e.search_document, e.embedding_version, e.enrichment_status, e.description_unavailable);
  elsif p.action = 'update' then
    perform set_config('ba_events.intake_commit', 'on', true);
    update public.events set name=e.name, starts_at=e.starts_at, ends_at=e.ends_at, time_tba=e.time_tba,
      venue_id=e.venue_id, description_es=e.description_es, description_en=e.description_en,
      description_display_es=e.description_display_es, description_display_en=e.description_display_en,
      description_summary_es=e.description_summary_es, description_summary_en=e.description_summary_en,
      categories=e.categories, price=e.price, is_free=e.is_free, image_url=coalesce(e.image_url, previous.image_url),
      image_width=e.image_width, image_height=e.image_height,
      ticket_url=coalesce(e.ticket_url, previous.ticket_url), status=e.status,
      embedding=e.embedding, search_document=e.search_document, embedding_version=e.embedding_version,
      enrichment_status=e.enrichment_status, description_unavailable=e.description_unavailable
    where id=p.event_id;
    perform set_config('ba_events.intake_commit', 'off', true);
  end if;
  for ev in select * from jsonb_array_elements(p.evidence) loop
    insert into public.event_source_evidence(event_id, candidate_id, observation_id, revision)
    values(p.event_id, p.candidate_id, (ev->>'observation_id')::uuid, p.revision)
    on conflict(event_id, candidate_id, observation_id) do update set revision=excluded.revision;
  end loop;
  if p.action <> 'link' then
    insert into public.event_intake_protection(event_id, fields, plan_id, authority, observed_at)
    values(p.event_id, array['name','starts_at','ends_at','time_tba','venue_id','price','is_free','status','image_url','image_width','image_height',
      'description_es','description_en','description_display_es','description_display_en','description_summary_es',
      'description_summary_en','categories','ticket_url','facets','embedding','embedding_version','search_document'], p.id, level, observed)
    on conflict(event_id) do update set fields=excluded.fields, plan_id=excluded.plan_id, authority=excluded.authority, observed_at=excluded.observed_at;
  end if;
  result_receipt := jsonb_build_object('plan_id',p.id,'candidate_id',p.candidate_id,'revision',p.revision,'action',p.action,'event_id',p.event_id,'committed_at',now(),'previous_event',case when p.action='update' then to_jsonb(previous) else null end);
  update public.intake_plans set receipt=result_receipt where id=p.id;
  return result_receipt;
end $$;

revoke all on function public.reserve_instagram_collection() from public, anon, authenticated;
revoke all on function public.submit_intake_candidate(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.commit_intake_plan(uuid) from public, anon, authenticated;
revoke all on function public.check_intake_plan(uuid) from public, anon, authenticated;
revoke all on function public.protect_intake_event_facts() from public, anon, authenticated;
grant execute on function public.reserve_instagram_collection(), public.submit_intake_candidate(uuid, integer, jsonb), public.commit_intake_plan(uuid) to service_role;
grant execute on function public.check_intake_plan(uuid) to service_role;

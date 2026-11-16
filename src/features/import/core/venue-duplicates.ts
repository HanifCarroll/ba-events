/**
 * Duplicate-venue merge planning for `scripts/venue-duplicates.ts`. Pure functions over a read-only snapshot of the
 * catalog: `planDuplicates` decides which same-name copies are one place, `mergeSql` writes the one-transaction merge
 * (which saves execution-time before-images in `public.venue_merge_backup`), `UNDO_SQL` restores the latest merge from
 * that table, and `mergeBackup` is the plan-time copy of the same rows for review.
 */
import { addressKey, pickVenue, venueNameKey } from './venue-identity.ts'
import { areaOnlyVenueName } from './venue-settlement.ts'

/** A complete venue row (`select=*`); the merge reads these fields and the backup keeps every column. */
export interface SnapshotVenue extends Record<string, unknown> {
  id: string; name: string; address: string | null; neighborhood: string | null
  website: string | null; instagram_handle: string | null; parent_id: string | null; created_at: string
}
/** Everything the merge reads or changes, as read from production with GET requests only. */
export interface VenueSnapshot {
  venues: SnapshotVenue[]
  events: Array<{ id: string; venue_id: string; status: string; updated_at?: string }>
  protected_event_ids: string[]
  review_queue: Array<{ id: string; best_match_venue_id: string | null; final_venue_id: string | null } & Record<string, unknown>>
  dismissed: Array<{ id: string; venue_id_1: string; venue_id_2: string } & Record<string, unknown>>
  intake_candidates: Array<{ id: string; venue_id: string }>
  intake_revisions: Array<{ candidate_id: string; revision: number; venue_id: string }>
  intake_plans: Array<{ id: string; venue_id: string }>
}

type Copy = Pick<SnapshotVenue, 'id' | 'name' | 'address' | 'neighborhood'> & { event_count: number }
export interface MergeGroup {
  name_key: string
  rule: 'no address' | 'one address' | 'same street and number'
  keeper: Copy
  sources: Copy[]
  /** Empty keeper fields filled from a source, so deleting the source loses nothing. */
  fill: Partial<Record<'address' | 'neighborhood' | 'website' | 'instagram_handle', string>>
  events: { scheduled: number; past: number; other: number }
  protected_event_ids: string[]
}
export interface KeptApart { name_key: string; reason: 'different addresses' | 'different barrios' | 'barrio name without a shared address'; venues: Copy[] }
export interface DuplicatePlan {
  counts: {
    venues: number; same_name_groups: number; merge_groups: number; venues_merged_away: number
    events_repointed: { scheduled: number; past: number; other: number }; protected_events_touched: number
    kept_apart_by_reason: Record<string, number>; possible_alias_groups: number
  }
  merges: MergeGroup[]
  kept_apart: KeptApart[]
  possible_aliases: Array<{ alias_key: string; venues: Copy[] }>
}

const FILLABLE = ['address', 'neighborhood', 'website', 'instagram_handle'] as const
// Generic words around a venue's own name, dropped only to list possible aliases for Hanif; never merged on.
const ALIAS_AFFIXES = /\b(club social|club|espacio cultural|espacio|centro cultural|cc|teatro|bar|sala|the|de|del|la|el|los|las)\b/g
const aliasKey = (nameKey: string) => nameKey.replace(ALIAS_AFFIXES, ' ').replace(/ /g, '')
const addressId = (venue: Copy) => addressKey(venue.address) ?? (venue.address?.trim() ? `unnumbered:${venueNameKey(venue.address)}` : null)
const barrios = (venues: Copy[]) => new Set(venues.map(venue => venue.neighborhood).filter(Boolean))

export function planDuplicates(snapshot: VenueSnapshot): DuplicatePlan {
  const eventsByVenue = Map.groupBy(snapshot.events, event => event.venue_id)
  const protectedIds = new Set(snapshot.protected_event_ids)
  const full = new Map(snapshot.venues.map(venue => [venue.id, venue]))
  const copy = (venue: SnapshotVenue): Copy => ({ id: venue.id, name: venue.name, address: venue.address,
    neighborhood: venue.neighborhood, event_count: eventsByVenue.get(venue.id)?.length ?? 0 })
  const byName = Map.groupBy(snapshot.venues.filter(venue => venueNameKey(venue.name)), venue => venueNameKey(venue.name))

  const merges: MergeGroup[] = []
  const keptApart: KeptApart[] = []
  const merge = (nameKey: string, rule: MergeGroup['rule'], copies: Copy[]) => {
    const keeper = pickVenue(copies.map(venue => ({ ...venue, created_at: full.get(venue.id)!.created_at })))!
    const sources = copies.filter(venue => venue.id !== keeper.id)
    const fill: MergeGroup['fill'] = {}
    for (const field of FILLABLE) {
      if (full.get(keeper.id)![field]?.trim()) continue
      const value = sources.map(source => full.get(source.id)![field]).find(item => item?.trim())
      if (value) fill[field] = value
    }
    const moved = sources.flatMap(source => eventsByVenue.get(source.id) ?? [])
    merges.push({ name_key: nameKey, rule, keeper: copies.find(venue => venue.id === keeper.id)!, sources, fill,
      events: { scheduled: moved.filter(event => event.status === 'scheduled').length, past: moved.filter(event => event.status === 'past').length,
        other: moved.filter(event => !['scheduled', 'past'].includes(event.status)).length },
      protected_event_ids: moved.filter(event => protectedIds.has(event.id)).map(event => event.id).sort() })
    return copies.find(venue => venue.id === keeper.id)!
  }

  for (const [nameKey, group] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    if (group.length < 2) continue
    const copies = group.map(copy).sort((a, b) => a.id.localeCompare(b.id))
    const addresses = new Set(copies.map(addressId).filter(Boolean))
    // A barrio-named venue is identified by its street address (PR #48), so only same-address copies merge.
    const barrioName = areaOnlyVenueName(group[0].name) === 'barrio'
    if (!barrioName && addresses.size <= 1) {
      if (barrios(copies).size > 1) keptApart.push({ name_key: nameKey, reason: 'different barrios', venues: copies })
      else merge(nameKey, addresses.size ? 'one address' : 'no address', copies)
      continue
    }
    // Several addresses: branches, rooms or different places sharing a name. Only copies at one street and number merge.
    const remaining: Copy[] = []
    for (const [key, atAddress] of Map.groupBy(copies, venue => addressKey(venue.address) ?? `alone:${venue.id}`)) {
      if (!key.startsWith('alone:') && atAddress.length > 1 && barrios(atAddress).size <= 1) remaining.push(merge(nameKey, 'same street and number', atAddress))
      else remaining.push(...atAddress)
    }
    if (remaining.length > 1) keptApart.push({ name_key: nameKey, venues: remaining,
      reason: barrioName && addresses.size <= 1 ? 'barrio name without a shared address' : 'different addresses' })
  }

  const mergedAway = new Set(merges.flatMap(group => group.sources.map(source => source.id)))
  const aliasGroups = Map.groupBy(snapshot.venues.filter(venue => !mergedAway.has(venue.id) && aliasKey(venueNameKey(venue.name)).length >= 4),
    venue => aliasKey(venueNameKey(venue.name)))
  const possibleAliases = [...aliasGroups].filter(([, venues]) => new Set(venues.map(venue => venueNameKey(venue.name))).size > 1)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, venues]) => ({ alias_key: key, venues: venues.map(copy) }))

  const sum = (pick: (group: MergeGroup) => number) => merges.reduce((total, group) => total + pick(group), 0)
  return {
    counts: {
      venues: snapshot.venues.length,
      same_name_groups: [...byName.values()].filter(group => group.length > 1).length,
      merge_groups: merges.length,
      venues_merged_away: mergedAway.size,
      events_repointed: { scheduled: sum(group => group.events.scheduled), past: sum(group => group.events.past), other: sum(group => group.events.other) },
      protected_events_touched: sum(group => group.protected_event_ids.length),
      kept_apart_by_reason: Object.fromEntries([...Map.groupBy(keptApart, group => group.reason)].map(([reason, groups]) => [reason, groups.length])),
      possible_alias_groups: possibleAliases.length,
    },
    merges, kept_apart: keptApart, possible_aliases: possibleAliases,
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const uuid = (id: string) => { if (!UUID.test(id)) throw new Error(`Not a venue id: ${id}`); return `'${id}'::uuid` }
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`

/**
 * One transaction:
 * 1. Check the plan still fits: every planned venue exists with the name, address and barrio the plan approved.
 *    Anything changed since the plan aborts and asks for a new plan.
 * 2. Save before-images of every row it is about to change into `public.venue_merge_backup` (from the migration; full venue, review,
 *    intake and dismissed-pair rows; `id`, `venue_id` and `updated_at` of events), read at execution time, so references
 *    added after the plan are covered too. `UNDO_SQL` restores from it.
 * 3. Fill the keepers' empty fields, repoint every reference to a source venue (events, the review queue, parent
 *    venues, the intake's candidate, revision and plan payloads), check nothing still points at a source, drop the
 *    sources' dismissed pairs, delete the sources, check again, and commit.
 * Committed intake receipts are history and keep the venue they recorded. Any failed check rolls everything back.
 */
export function mergeSql(plan: Pick<DuplicatePlan, 'merges'>): string {
  const pairs = plan.merges.flatMap(group => group.sources.map(source => `(${uuid(source.id)}, ${uuid(group.keeper.id)})`))
  if (!pairs.length) throw new Error('The plan has no merges')
  const nullable = (value: string | null) => value === null ? 'null' : literal(value)
  const planned = plan.merges.flatMap(group => [group.keeper, ...group.sources])
    .map(venue => `(${uuid(venue.id)}, ${literal(venue.name)}, ${nullable(venue.address)}, ${nullable(venue.neighborhood)})`)
  // neighborhood is the public.neighborhood enum (no blank value, no btrim); the other fills are text.
  const fills = plan.merges.flatMap(group => Object.entries(group.fill).map(([field, value]) => field === 'neighborhood'
    ? `update public.venues set neighborhood = coalesce(neighborhood, ${literal(value!)}::public.neighborhood) where id = ${uuid(group.keeper.id)};`
    : `update public.venues set ${field} = coalesce(nullif(btrim(${field}), ''), ${literal(value!)}) where id = ${uuid(group.keeper.id)};`))
  const jsonRepoint = (table: string) => `update public.${table} t set payload = jsonb_set(t.payload, '{venue_id}', to_jsonb(m.keeper::text))
  from venue_merge m where t.payload->>'venue_id' = m.source::text;`
  const saveJson = (kind: string, table: string) => `insert into public.venue_merge_backup(merged_at, kind, row)
  select now(), '${kind}', to_jsonb(t) from public.${table} t join venue_merge m on t.payload->>'venue_id' = m.source::text;`
  return `-- Generated by scripts/venue-duplicates.ts sql. Run it whole: any failed check rolls everything back.
-- Undo with undo.sql, which restores the latest merge saved in public.venue_merge_backup.
begin;
-- Without this, protect_intake_event_facts silently reverts venue_id on intake-protected events.
set local ba_events.intake_commit = 'on';
create temp table venue_merge(source uuid primary key, keeper uuid not null) on commit drop;
insert into venue_merge(source, keeper) values
  ${pairs.join(',\n  ')};
-- The name, address and barrio each merge was approved on.
create temp table venue_planned(id uuid primary key, name text not null, address text, neighborhood text) on commit drop;
insert into venue_planned(id, name, address, neighborhood) values
  ${planned.join(',\n  ')};
do $$ declare changed text; begin
  if exists(select 1 from venue_merge m where m.keeper in (select source from venue_merge)) then raise exception 'A keeper is also a source'; end if;
  select string_agg(p.id::text, ', ') into changed from venue_planned p left join public.venues v on v.id = p.id
    where v.id is null or (v.name, v.address, v.neighborhood::text) is distinct from (p.name, p.address, p.neighborhood);
  if changed is not null then raise exception 'Venues deleted or changed since the plan (%); run plan again', changed; end if;
end $$;
insert into public.venue_merge_backup(merged_at, kind, row)
  select now(), 'venue', to_jsonb(v) from public.venues v
  where v.id in (select source from venue_merge union select keeper from venue_merge) or v.parent_id in (select source from venue_merge);
insert into public.venue_merge_backup(merged_at, kind, row)
  select now(), 'event', jsonb_build_object('id', e.id, 'venue_id', e.venue_id, 'updated_at', e.updated_at)
  from public.events e join venue_merge m on e.venue_id = m.source;
insert into public.venue_merge_backup(merged_at, kind, row)
  select now(), 'review', to_jsonb(q) from public.venue_review_queue q
  where q.best_match_venue_id in (select source from venue_merge) or q.final_venue_id in (select source from venue_merge);
${saveJson('intake_candidate', 'intake_candidates')}
${saveJson('intake_revision', 'intake_candidate_revisions')}
${saveJson('intake_plan', 'intake_plans')}
insert into public.venue_merge_backup(merged_at, kind, row)
  select now(), 'dismissed', to_jsonb(d) from public.dismissed_venue_duplicates d
  where d.venue_id_1 in (select source from venue_merge) or d.venue_id_2 in (select source from venue_merge);
${fills.join('\n')}
update public.events e set venue_id = m.keeper from venue_merge m where e.venue_id = m.source;
update public.venue_review_queue q set best_match_venue_id = m.keeper from venue_merge m where q.best_match_venue_id = m.source;
update public.venue_review_queue q set final_venue_id = m.keeper from venue_merge m where q.final_venue_id = m.source;
update public.venues v set parent_id = nullif(m.keeper, v.id) from venue_merge m where v.parent_id = m.source;
${jsonRepoint('intake_candidates')}
${jsonRepoint('intake_candidate_revisions')}
${jsonRepoint('intake_plans')}
-- Checked before the delete: foreign keys with ON DELETE SET NULL would otherwise hide a missed reference.
do $$ begin
  if exists(select 1 from public.events e join venue_merge m on e.venue_id = m.source) then raise exception 'An event still points at a source venue'; end if;
  if exists(select 1 from public.venue_review_queue q join venue_merge m on m.source in (q.best_match_venue_id, q.final_venue_id))
    then raise exception 'A review row still points at a source venue'; end if;
  if exists(select 1 from public.venues v join venue_merge m on v.parent_id = m.source) then raise exception 'A venue still has a source as parent'; end if;
  if exists(select 1 from venue_merge m where exists(select 1 from public.intake_candidates t where t.payload->>'venue_id' = m.source::text)
    or exists(select 1 from public.intake_candidate_revisions t where t.payload->>'venue_id' = m.source::text)
    or exists(select 1 from public.intake_plans t where t.payload->>'venue_id' = m.source::text))
    then raise exception 'An intake payload still points at a source venue'; end if;
end $$;
delete from public.dismissed_venue_duplicates d using venue_merge m where m.source in (d.venue_id_1, d.venue_id_2);
delete from public.venues v using venue_merge m where v.id = m.source;
do $$ begin
  if exists(select 1 from public.venues v join venue_merge m on v.id = m.source) then raise exception 'A source venue survived'; end if;
  if exists(select 1 from public.events e where e.venue_id is not null and not exists(select 1 from public.venues v where v.id = e.venue_id))
    then raise exception 'An event points at a deleted venue'; end if;
end $$;
commit;
`
}

/**
 * Restores the latest merge from `public.venue_merge_backup`: deleted venues come back with every column, and every
 * changed field (keeper fills, parent links, event and review-queue venues, intake payloads, dismissed pairs) gets its
 * old value. Rows that existed throughout get a fresh `updated_at` from their triggers; the old value stays in the backup.
 */
export const UNDO_SQL = `-- Generated by scripts/venue-duplicates.ts sql. Restores the latest merge saved in public.venue_merge_backup.
begin;
set local ba_events.intake_commit = 'on';
create temp table undo_rows on commit drop as
  select kind, row from public.venue_merge_backup where merged_at = (select max(merged_at) from public.venue_merge_backup);
do $$ begin if not exists(select 1 from undo_rows) then raise exception 'No merge backup to undo'; end if; end $$;
create temp table undo_venues on commit drop as
  select (jsonb_populate_record(null::public.venues, row)).* from undo_rows where kind = 'venue';
-- Deleted venues first, without parents, so the parent foreign key holds while they come back. Inserts keep every
-- column as saved, updated_at included.
insert into public.venues select (jsonb_populate_record(null::public.venues, r.row || '{"parent_id": null}')).* from undo_rows r
  where r.kind = 'venue' and not exists(select 1 from public.venues v where v.id = (r.row->>'id')::uuid);
update public.venues v set parent_id = u.parent_id, address = u.address, neighborhood = u.neighborhood,
  website = u.website, instagram_handle = u.instagram_handle
  from undo_venues u where v.id = u.id
  and (v.parent_id, v.address, v.neighborhood, v.website, v.instagram_handle)
    is distinct from (u.parent_id, u.address, u.neighborhood, u.website, u.instagram_handle);
update public.events e set venue_id = (r.row->>'venue_id')::uuid from undo_rows r
  where r.kind = 'event' and e.id = (r.row->>'id')::uuid;
update public.venue_review_queue q set best_match_venue_id = (r.row->>'best_match_venue_id')::uuid,
  final_venue_id = (r.row->>'final_venue_id')::uuid from undo_rows r where r.kind = 'review' and q.id = (r.row->>'id')::uuid;
update public.intake_candidates t set payload = r.row->'payload' from undo_rows r
  where r.kind = 'intake_candidate' and t.id = (r.row->>'id')::uuid;
update public.intake_candidate_revisions t set payload = r.row->'payload' from undo_rows r
  where r.kind = 'intake_revision' and t.candidate_id = (r.row->>'candidate_id')::uuid and t.revision = (r.row->>'revision')::integer;
update public.intake_plans t set payload = r.row->'payload' from undo_rows r
  where r.kind = 'intake_plan' and t.id = (r.row->>'id')::uuid;
insert into public.dismissed_venue_duplicates select (jsonb_populate_record(null::public.dismissed_venue_duplicates, row)).*
  from undo_rows where kind = 'dismissed' on conflict do nothing;
commit;
`

/**
 * Plan-time copy, for review and as an offline record: complete source and keeper venue rows, and the old value of every
 * field the merge changes. The authoritative backup is the one merge.sql writes at execution time.
 */
export function mergeBackup(plan: Pick<DuplicatePlan, 'merges'>, snapshot: VenueSnapshot) {
  const keeperOf = new Map(plan.merges.flatMap(group => group.sources.map(source => [source.id, group.keeper.id] as const)))
  const moved = (id: string | null) => !!id && keeperOf.has(id)
  const full = new Map(snapshot.venues.map(venue => [venue.id, venue]))
  return {
    note: 'Taken at plan time. merge.sql saves the execution-time rows in public.venue_merge_backup, and undo.sql restores from there.',
    source_venues: [...keeperOf.keys()].map(id => full.get(id)),
    keeper_venues: plan.merges.map(group => full.get(group.keeper.id)),
    events: snapshot.events.filter(event => moved(event.venue_id)).map(({ id, venue_id, updated_at }) => ({ id, venue_id, updated_at })),
    venue_review_queue: snapshot.review_queue.filter(row => moved(row.best_match_venue_id) || moved(row.final_venue_id)),
    venue_parents: snapshot.venues.filter(venue => moved(venue.parent_id)).map(({ id, parent_id }) => ({ id, parent_id })),
    intake_candidates: snapshot.intake_candidates.filter(row => moved(row.venue_id)),
    intake_candidate_revisions: snapshot.intake_revisions.filter(row => moved(row.venue_id)),
    intake_plans: snapshot.intake_plans.filter(row => moved(row.venue_id)),
    dismissed_pairs: snapshot.dismissed.filter(row => moved(row.venue_id_1) || moved(row.venue_id_2)),
  }
}

export function planSummary(plan: DuplicatePlan): string {
  const c = plan.counts
  const line = (group: MergeGroup) => `- ${group.keeper.name} (${group.keeper.address ?? 'no address'}): keeps ${group.keeper.id}, merges ${group.sources.length}, `
    + `moves ${group.events.scheduled + group.events.past + group.events.other} events${group.protected_event_ids.length ? `, ${group.protected_event_ids.length} protected` : ''}`
  return [
    '# Duplicate venues: merge plan', '',
    `- Venues: ${c.venues}`,
    `- Same-name groups: ${c.same_name_groups}`,
    `- Groups merged: ${c.merge_groups}, venues merged away: ${c.venues_merged_away}`,
    `- Events repointed: ${c.events_repointed.scheduled} scheduled, ${c.events_repointed.past} past, ${c.events_repointed.other} other`,
    `- Intake-protected events touched: ${c.protected_events_touched}`,
    `- Groups kept apart: ${Object.entries(c.kept_apart_by_reason).map(([reason, count]) => `${count} ${reason}`).join(', ') || 'none'}`,
    `- Possible aliases for Hanif (not merged): ${c.possible_alias_groups} groups`, '',
    '## Largest merges', '', ...[...plan.merges].sort((a, b) => b.sources.length - a.sources.length).slice(0, 15).map(line), '',
    '## Kept apart', '', ...plan.kept_apart.slice(0, 40).map(group => `- ${group.venues[0].name}: ${group.reason} (${group.venues.map(venue => venue.address ?? 'no address').join('; ')})`), '',
  ].join('\n')
}

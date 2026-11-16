import { describe, expect, it } from 'vitest'
import { mergeBackup, mergeSql, planDuplicates, type VenueSnapshot } from './venue-duplicates.ts'
import { snapshot } from '../../../../supabase/tests/venue-merge.ts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('planDuplicates', () => {
  const plan = planDuplicates(snapshot)

  it('merges same-name copies at one address into the most complete one', () => {
    const group = plan.merges.find(merge => merge.name_key === 'sala sintetica')!
    expect(group.keeper.id).toBe(id(3))
    expect(group.sources.map(source => source.id).sort()).toEqual([id(1), id(2)])
    expect(group.fill).toEqual({ website: 'https://sala.example' })
    expect(group.protected_event_ids).toEqual([id(103)])
    expect(plan.counts).toMatchObject({ merge_groups: 2, venues_merged_away: 3, events_repointed: { scheduled: 3, past: 1, other: 0 }, protected_events_touched: 1 })
  })

  it('fills the keeper\u2019s empty barrio from a source, as an enum value', () => {
    const group = plan.merges.find(merge => merge.name_key === 'teatro fijo')!
    expect([group.keeper.id, group.sources.map(source => source.id), group.fill]).toEqual([id(9), [id(10)], { neighborhood: 'Palermo' }])
    expect(mergeSql(plan)).toContain(`set neighborhood = coalesce(neighborhood, 'Palermo'::public.neighborhood) where id = '${id(9)}'::uuid`)
    expect(mergeSql(plan)).not.toContain('btrim(neighborhood)')
  })

  it('keeps apart a name at different addresses and a barrio name without a shared address', () => {
    expect(plan.kept_apart.map(group => [group.name_key, group.reason])).toEqual([
      ['bar doble', 'different addresses'], ['san telmo', 'barrio name without a shared address']])
  })

  it('merges only the copies that share a street and number when a name has several addresses', () => {
    const venue = (n: number, address: string | null) => ({ id: id(n), name: 'Sala Rama', address, neighborhood: null, website: null,
      instagram_handle: null, parent_id: null, created_at: `2026-01-0${n}T00:00:00Z` })
    const split = planDuplicates({ ...snapshot, events: [],
      venues: [venue(1, 'Calle Norte 10'), venue(2, 'Avenida Norte N° 10, CABA'), venue(3, 'Calle Sur 20'), venue(4, null)] })
    expect(split.merges.map(group => group.sources.map(source => source.id))).toEqual([[id(2)]])
    expect(split.kept_apart).toEqual([expect.objectContaining({ reason: 'different addresses' })])
    expect(split.kept_apart[0].venues.map(venue => venue.id).sort()).toEqual([id(1), id(3), id(4)])
  })

  it('keeps apart same-name copies in different barrios, and lists aliases without merging them', () => {
    const venue = (n: number, name: string, neighborhood: string | null) => ({ id: id(n), name, address: null, neighborhood,
      website: null, instagram_handle: null, parent_id: null, created_at: '2026-01-01T00:00:00Z' })
    const result = planDuplicates({ ...snapshot, events: [],
      venues: [venue(1, 'Sala Lejana', 'Palermo'), venue(2, 'Sala Lejana', 'Boedo'), venue(3, 'Club Lucilla', null), venue(4, 'Lucilla Bar', null)] })
    expect(result.merges).toEqual([])
    expect(result.kept_apart.map(group => group.reason)).toEqual(['different barrios'])
    expect(result.possible_aliases.map(group => group.venues.map(venue => venue.id))).toEqual([[id(3), id(4)]])
  })
})

describe('mergeSql and mergeBackup', () => {
  const plan = planDuplicates(snapshot)

  it('writes one transaction that turns on intake_commit, checks the plan, saves before-images, and checks around the delete', () => {
    const sql = mergeSql(plan)
    expect(sql.match(/^begin;$/gm)).toHaveLength(1)
    expect(sql.trimEnd().endsWith('commit;')).toBe(true)
    expect(sql).toContain("set local ba_events.intake_commit = 'on';")
    expect(sql.indexOf('still points at a source venue')).toBeLessThan(sql.indexOf('delete from public.venues'))
    // The identity each merge was approved on is checked, and before-images are saved, before anything changes.
    expect(sql).toContain(`('${id(2)}'::uuid, 'Sala  Sintética', null, null)`)
    expect(sql.indexOf('changed since the plan')).toBeLessThan(sql.indexOf('insert into public.venue_merge_backup'))
    expect(sql.indexOf('insert into public.venue_merge_backup')).toBeLessThan(sql.indexOf('update public.events'))
    expect(sql).toContain(`('${id(1)}'::uuid, '${id(3)}'::uuid)`)
  })

  it('refuses an id that is not a uuid and an empty plan', () => {
    const bad = structuredClone(plan)
    bad.merges[0].sources[0].id = "x'); drop table venues; --"
    expect(() => mergeSql(bad)).toThrow('Not a venue id')
    expect(() => mergeSql({ merges: [] })).toThrow('no merges')
  })

  it('backs up the sources and every reference the merge changes', () => {
    const backup = mergeBackup(plan, snapshot as VenueSnapshot)
    expect(backup.source_venues.map(venue => venue?.id).sort()).toEqual([id(1), id(2), id(10)].sort())
    expect(backup.events.map(event => event.id).sort()).toEqual([id(101), id(102), id(103), id(106)])
    expect(backup.keeper_venues.map(venue => venue?.id).sort()).toEqual([id(3), id(9)])
    expect(backup.source_venues[0]).toHaveProperty('address_check_status', 'flagged')
    expect(backup).toMatchObject({ venue_parents: [{ id: id(6), parent_id: id(2) }], dismissed_pairs: [{ id: id(301) }],
      intake_candidates: [{ id: id(401) }], intake_candidate_revisions: [{ candidate_id: id(401) }], intake_plans: [{ id: id(501) }] })
    expect(backup.venue_review_queue).toHaveLength(1)
  })
})

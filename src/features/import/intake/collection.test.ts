import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import { retainPostsEffect, sourceCoverage } from './collection.ts'

/** In-memory intake_observations/intake_media with only the query shapes retainPostsEffect uses. */
function memoryDb() {
  const observations: Array<{ id: string; run_id: string; post_id: string; content_hash: string; source_username: string }> = []
  const table = (name: string) => {
    let op = 'select'; let row: Record<string, string> = {}; const filters: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {
      select: () => chain, order: () => chain, limit: () => chain, single: () => chain,
      eq: (key: string, value: unknown) => { filters[key] = value; return chain },
      update: () => { op = 'update'; return chain },
      upsert: (value: Record<string, string>) => { op = 'upsert'; row = value; return chain },
      then: (resolve: (value: unknown) => void) => {
        if (name === 'intake_media') return resolve({ data: [], error: null })
        if (op === 'update') return resolve({ data: { id: filters.id }, error: null })
        if (op === 'upsert') {
          const saved = { id: `obs-${observations.length}`, run_id: row.run_id, post_id: row.post_id, content_hash: row.content_hash, source_username: row.source_username }
          observations.push(saved); return resolve({ data: saved, error: null })
        }
        return resolve({ data: observations.filter(item => item.post_id === filters.post_id).slice(-1), error: null })
      },
    }
    return chain
  }
  return { db: { from: table } as unknown as SupabaseClient, observations }
}
const post = (id: string, owner = 'synthetic_venue') => ({ id, shortCode: `sc${id}`, ownerUsername: owner, caption: `Synthetic ${id}`, timestamp: '2026-11-12T12:00:00Z' })
const noItems = (name: string) => ({ url: `https://www.instagram.com/${name}`, inputUrl: `https://www.instagram.com/${name}`, error: 'no_items', errorDescription: 'Empty or private data for provided input' })

describe('incremental Instagram collection', () => {
  it('treats posts re-fetched in the one-day overlap as unchanged, not new observations', async () => {
    const { db, observations } = memoryDb()
    const first = await Effect.runPromise(retainPostsEffect(db, 'run-1', [post('1'), post('2')], ['synthetic_venue'], 20))
    const second = await Effect.runPromise(retainPostsEffect(db, 'run-2', [post('2'), post('3')], ['synthetic_venue'], 20))
    expect(first).toMatchObject({ changed: 2, unchanged: 0 })
    expect(second).toMatchObject({ changed: 1, unchanged: 1 })
    expect(observations.map(item => item.post_id)).toEqual(['1', '2', '3'])
  })

  it('skips billed error rows without failing and names dead, quiet and uncovered sources', async () => {
    const { db, observations } = memoryDb()
    const rows = [post('1'), noItems('quiet_one'),
      { url: 'https://www.instagram.com/gone_one', username: 'gone_one', error: 'not_found', errorDescription: 'Profile does not exist' },
      { url: 'https://www.instagram.com/adults_only', inputUrl: 'https://www.instagram.com/adults_only', error: 'restricted', errorDescription: 'Restricted profile' }]
    const result = await Effect.runPromise(retainPostsEffect(db, 'run', rows, ['synthetic_venue', 'quiet_one', 'gone_one', 'adults_only', 'never_reached'], 20))
    expect(observations).toHaveLength(1)
    expect(result.coverage).toEqual({ charged_rows: 4, quiet_sources: ['quiet_one'],
      dead_sources: [{ username: 'gone_one', reason: 'not_found: Profile does not exist' }, { username: 'adults_only', reason: 'restricted: Restricted profile' }],
      errored_sources: [], at_ceiling_sources: [], uncovered_sources: ['never_reached'] })
    expect(result.failures).toEqual([
      'Sources not found or restricted (consider disabling): gone_one, adults_only',
      expect.stringContaining('Run stopped before covering 1 sources'),
    ])
  })

  it('attributes collab posts to a configured coauthor and keeps one observation per post', async () => {
    const { db, observations } = memoryDb()
    // Shaped like a real 0.0.679 row: owner is an unconfigured co-poster, no inputUrl.
    const collab = { id: '9', shortCode: 'sc9', ownerUsername: 'synthetic_artist', caption: 'Synthetic collab', timestamp: '2026-11-12T12:00:00Z',
      url: 'https://www.instagram.com/p/sc9/', coauthorProducers: [
        { username: 'unrelated_brand', is_verified: false, profile_pic_url: 'https://scontent.cdninstagram.com/a.jpg', id: '1' },
        { username: 'Synthetic_Venue', is_verified: false, profile_pic_url: 'https://scontent.cdninstagram.com/b.jpg', id: '2' },
        { username: 'synthetic_club', is_verified: true, profile_pic_url: 'https://scontent.cdninstagram.com/c.jpg', id: '3' }] }
    const stranger = { ...post('10', 'synthetic_artist'), coauthorProducers: [{ username: 'unrelated_brand' }] }
    const usernames = ['synthetic_venue', 'synthetic_club']
    const result = await Effect.runPromise(retainPostsEffect(db, 'run', [collab, collab, stranger], usernames, 20))
    expect(observations.map(item => item.source_username)).toEqual(['synthetic_venue'])
    expect(result).toMatchObject({ changed: 1, failures: ['A post owner did not match the configured source'] })
    expect(result.coverage.uncovered_sources).toEqual(['synthetic_club'])
    expect(sourceCoverage([collab], ['synthetic_venue'], 1)).toMatchObject({ uncovered_sources: [], at_ceiling_sources: ['synthetic_venue'] })
  })

  it('flags accounts that reached the per-run ceiling', () => {
    expect(sourceCoverage([post('1'), post('2'), post('3', 'other')], ['synthetic_venue', 'other'], 2).at_ceiling_sources).toEqual(['synthetic_venue'])
  })
})

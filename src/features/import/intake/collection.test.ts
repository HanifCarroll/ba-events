import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import { retainPostsEffect, retryMissingMediaEffect, signedUrlExpiry, sourceCoverage } from './collection.ts'

/** In-memory intake_observations/intake_media with only the query shapes retainPostsEffect uses. */
function memoryDb() {
  const seen: unknown[] = []
  const observations: Array<{ id: string; run_id: string; post_id: string; content_hash: string; source_username: string }> = []
  const table = (name: string) => {
    let op = 'select'; let row: Record<string, string> = {}; const filters: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {
      select: () => chain, order: () => chain, limit: () => chain, single: () => chain,
      eq: (key: string, value: unknown) => { filters[key] = value; return chain },
      update: (value: { last_seen_at: string }) => { op = 'update'; seen.push(value.last_seen_at); return chain },
      upsert: (value: Record<string, string>) => { op = 'upsert'; row = value; return chain },
      then: (resolve: (value: unknown) => void) => {
        if (name === 'intake_media') return resolve({ data: [], error: null })
        if (op === 'update') { seen.push(filters.id); return resolve({ data: { id: filters.id }, error: null }) }
        if (op === 'upsert') {
          const saved = { id: `obs-${observations.length}`, run_id: row.run_id, post_id: row.post_id, content_hash: row.content_hash, source_username: row.source_username }
          observations.push(saved); return resolve({ data: saved, error: null })
        }
        return resolve({ data: observations.filter(item => item.post_id === filters.post_id).slice(-1), error: null })
      },
    }
    return chain
  }
  return { db: { from: table } as unknown as SupabaseClient, observations, seen }
}
const post = (id: string, owner = 'synthetic_venue') => ({ id, shortCode: `sc${id}`, ownerUsername: owner, caption: `Synthetic ${id}`, timestamp: '2026-11-12T12:00:00Z' })
const noItems = (name: string) => ({ url: `https://www.instagram.com/${name}`, inputUrl: `https://www.instagram.com/${name}`, error: 'no_items', errorDescription: 'Empty or private data for provided input' })

describe('incremental Instagram collection', () => {
  it('treats posts re-fetched in the overlap margin as unchanged, not new observations', async () => {
    const { db, observations } = memoryDb()
    const first = await Effect.runPromise(retainPostsEffect(db, 'run-1', [post('1'), post('2')], ['synthetic_venue'], 20))
    const second = await Effect.runPromise(retainPostsEffect(db, 'run-2', [post('2'), post('3')], ['synthetic_venue'], 20))
    expect(first).toMatchObject({ changed: 2, unchanged: 0 })
    expect(second).toMatchObject({ changed: 1, unchanged: 1 })
    expect(observations.map(item => item.post_id)).toEqual(['1', '2', '3'])
  })

  it('marks a re-fetched carousel seen even when its signed image URLs changed', async () => {
    const { db, observations, seen } = memoryDb()
    const carousel = (sig: string) => ({ ...post('7'), childPosts: [
      { displayUrl: `https://scontent.cdninstagram.com/v/slide1.jpg?oh=${sig}&oe=1` },
      { displayUrl: `https://scontent.cdninstagram.com/v/slide2.jpg?oh=${sig}&oe=1` }] })
    await Effect.runPromise(retainPostsEffect(db, 'run-1', [carousel('first')], ['synthetic_venue'], 20, async () => { throw new Error('offline') }))
    const second = await Effect.runPromise(retainPostsEffect(db, 'run-2', [carousel('second')], ['synthetic_venue'], 20, async () => { throw new Error('offline') }))
    expect(second).toMatchObject({ changed: 0, unchanged: 1 })
    expect(observations).toHaveLength(1)
    expect(seen).toEqual([expect.any(String), 'obs-0'])
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
    expect(result).toMatchObject({ changed: 1, failures: [expect.stringContaining('covering 1 sources'), 'A post owner did not match the configured source'] })
    expect(result.coverage.uncovered_sources).toEqual(['synthetic_club'])
    expect(sourceCoverage([collab], ['synthetic_venue'], 1)).toMatchObject({ uncovered_sources: [], at_ceiling_sources: ['synthetic_venue'] })
  })

  it('flags accounts that reached the per-run ceiling', () => {
    expect(sourceCoverage([post('1'), post('2'), post('3', 'other')], ['synthetic_venue', 'other'], 2).at_ceiling_sources).toEqual(['synthetic_venue'])
  })
})

/** Unreviewed observations with stored URLs and their saved media, behind the query shapes the media retry uses. */
function mediaDb(observations: Array<{ id: string; media_urls: string[]; reviewed_at?: string }>, media: Array<{ observation_id: string; position: number }>) {
  const uploads: string[] = []
  const from = (name: string) => {
    let row: Record<string, unknown> | null = null; let ids: string[] | null = null; let unreviewed = false
    const chain: Record<string, unknown> = {
      select: () => chain, order: () => chain, range: () => chain, single: () => chain,
      is: () => { unreviewed = true; return chain },
      in: (_key: string, values: string[]) => { ids = values; return chain },
      upsert: (value: Record<string, unknown>) => { row = value; return chain },
      then: (resolve: (value: unknown) => void) => {
        if (row) { media.push(row as { observation_id: string; position: number }); return resolve({ data: { id: 'media' }, error: null }) }
        if (name === 'intake_observations') return resolve({ data: observations.filter(item => !unreviewed || !item.reviewed_at), error: null })
        return resolve({ data: media.filter(item => !ids || ids.includes(item.observation_id)), error: null })
      },
    }
    return chain
  }
  const storage = { from: () => ({ upload: async (key: string) => { uploads.push(key); return { data: { path: key }, error: null } } }) }
  return { db: { from, storage } as unknown as SupabaseClient, media, uploads }
}
const now = new Date('2026-11-16T12:00:00Z')
const signed = (name: string, expiry: Date) => `https://scontent.cdninstagram.com/v/${name}.jpg?oh=sig&oe=${Math.floor(expiry.getTime() / 1000).toString(16)}`
const image = async (url: string) => ({ bytes: new Uint8Array([1]), content_type: 'image/jpeg', sha256: 'a'.repeat(64), object_key: `${url.length}.jpg` })

describe('retrying missing images of unreviewed observations', () => {
  const later = new Date('2026-11-19T12:00:00Z'), earlier = new Date('2026-11-15T12:00:00Z')

  it('saves a previously failed position, never refetches a saved one, and skips and reports an expired URL', async () => {
    const observations = [
      { id: 'colon', media_urls: [signed('slide0', later), signed('slide1', later), signed('slide2', later)] },
      { id: 'old', media_urls: [signed('gone', earlier)] },
      { id: 'done', media_urls: [signed('reviewed', later)], reviewed_at: '2026-11-15T13:00:00Z' },
    ]
    const { db, media } = mediaDb(observations, [{ observation_id: 'colon', position: 1 }])
    const fetched: string[] = []
    const result = await Effect.runPromise(retryMissingMediaEffect(db, { now, fetcher: async url => { fetched.push(url); return image(url) } }))
    expect(fetched).toEqual([signed('slide0', later), signed('slide2', later)])
    expect(media).toEqual(expect.arrayContaining([expect.objectContaining({ observation_id: 'colon', position: 0 }), expect.objectContaining({ observation_id: 'colon', position: 2 })]))
    expect(result).toMatchObject({ attempted: 2, retained: 2, expired: 1, deferred: 0,
      failures: [expect.stringMatching(/^Media 0 of observation old can't be retried: its stored URL expired 2026-11-15/)] })

    fetched.length = 0
    const again = await Effect.runPromise(retryMissingMediaEffect(db, { now, fetcher: async url => { fetched.push(url); return image(url) } }))
    expect(fetched).toEqual([])
    expect(again).toMatchObject({ attempted: 0, retained: 0, expired: 1 })
  })

  it('reports a retry that fails again, skips observations collected this run, and caps downloads per run', async () => {
    const { db } = mediaDb([
      { id: 'flaky', media_urls: [signed('a', later)] },
      { id: 'today', media_urls: [signed('b', later)] },
      { id: 'big', media_urls: [signed('c', later), signed('d', later), signed('e', later)] },
    ], [])
    const fetched: string[] = []
    const result = await Effect.runPromise(retryMissingMediaEffect(db, { now, cap: 2, skip: new Set(['today']),
      fetcher: async url => { fetched.push(url); if (url.includes('/a.jpg')) throw new Error('offline'); return image(url) } }))
    expect(fetched).toEqual([signed('a', later), signed('c', later)])
    expect(result).toMatchObject({ attempted: 2, retained: 1, deferred: 2, failures: [
      'Media 0 could not be retained for observation flaky (retried from its stored URL)',
      '2 missing images were not retried this run (cap 2); the next collect retries them'] })
  })

  it('reads the hex expiry from a signed Instagram URL', () => {
    expect(signedUrlExpiry('https://scontent.cdninstagram.com/v/x.jpg?oe=691E1234')?.toISOString()).toBe('2025-11-19T18:53:40.000Z')
    expect(signedUrlExpiry('https://scontent.cdninstagram.com/v/x.jpg')).toBeNull()
    expect(signedUrlExpiry('not a url')).toBeNull()
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NAME_FOLD_FROM, NAME_FOLD_TO, keeperOrder, pickVenue, venueNameKey, type VenueCopy } from './venue-identity.ts'
import { matchVenueEffect } from '../scrapers/venue-matcher.ts'

describe('venueNameKey', () => {
  it('folds case, accents, doubled and non-breaking spaces, punctuation, and city suffixes', () => {
    for (const name of ['Teatro Ópera', 'teatro  opera', 'Teatro\u00a0Ópera', 'Teatro Ópera —', 'TEATRO ÓPERA - Buenos Aires',
      'Teatro Ópera - CABA', 'Teatro Ópera – Argentina', ' Teatro Ópera - Buenos Aires - Argentina '])
      expect(venueNameKey(name), name).toBe('teatro opera')
    expect(venueNameKey('Nobleza Obliga - Cuenta 2783 - CABA')).toBe('nobleza obliga cuenta 2783')
    expect(venueNameKey('Glück - Villa Urquiza')).toBe('gluck villa urquiza')
    expect(venueNameKey('ÑANDÚ')).toBe('nandu')
  })

  it('treats % and _ as punctuation, not wildcards', () => {
    expect(venueNameKey('Club 100%_Sur')).toBe('club 100 sur')
    expect(venueNameKey('Club 100% Sur')).not.toBe(venueNameKey('Club 1000 Sur'))
  })

  it('keeps a name that is only a suffix word, and different places apart', () => {
    expect(venueNameKey('Buenos Aires - Argentina')).toBe('buenos aires')
    expect(venueNameKey('Teatro Buenos Aires')).toBe('teatro buenos aires')
    expect(venueNameKey('Sala A')).not.toBe(venueNameKey('Sala B'))
    expect(venueNameKey('---')).toBe('')
  })

  it('uses the same fold table as public.venue_name_key', () => {
    expect([...NAME_FOLD_FROM]).toHaveLength([...NAME_FOLD_TO].length)
    const sql = readFileSync(new URL('../../../../supabase/migrations/20261116180000_venue_name_matching.sql', import.meta.url), 'utf8')
    expect(sql).toContain(`'${NAME_FOLD_FROM.replace('\u00a0', '')}' || chr(160), '${NAME_FOLD_TO}'`)
  })
})

const copy = (id: string, extra: Partial<VenueCopy> = {}): VenueCopy =>
  ({ id, address: null, neighborhood: null, created_at: '2026-01-01T00:00:00Z', event_count: 0, ...extra })

describe('keeper and pick rules', () => {
  it('keeps the most complete address and barrio, then the most events, then the oldest', () => {
    const numbered = copy('numbered', { address: 'Calle Norte 100' })
    const vague = copy('vague', { address: 'Calle Norte', neighborhood: 'Palermo', event_count: 50 })
    expect([vague, numbered].sort(keeperOrder)[0].id).toBe('numbered')
    expect([copy('few', { event_count: 1 }), copy('many', { event_count: 5 })].sort(keeperOrder)[0].id).toBe('many')
    expect([copy('new', { created_at: '2026-02-01T00:00:00Z' }), copy('old')].sort(keeperOrder)[0].id).toBe('old')
  })

  it('prefers the copy at the same street and number, and keeps the keeper when the event has no address', () => {
    const venues = [copy('norte', { address: 'Calle Norte 100' }), copy('sur', { address: 'Calle Sur 200', event_count: 3 })]
    expect(pickVenue(venues, 'Calle Norte N° 100, CABA')?.id).toBe('norte')
    expect(pickVenue(venues)?.id).toBe('sur')
    expect(pickVenue(venues, 'sin número')?.id).toBe('sur')
    expect(pickVenue([])).toBeNull()
  })

  it('never picks a copy at another street and number', () => {
    const venues = [copy('norte', { address: 'Calle Norte 100' }), copy('sur', { address: 'Calle Sur 200', event_count: 3 })]
    expect(pickVenue(venues, 'Calle Oeste 300')).toBeNull()
    // A copy with no numbered address isn't a conflict.
    expect(pickVenue([...venues, copy('bare', { address: 'Calle Sur' })], 'Calle Oeste 300')?.id).toBe('bare')
  })
})

describe('matchVenueEffect', () => {
  const sala = { id: 'sala', name: 'Sala  Sintética', address: 'Calle Norte 100', neighborhood: 'Palermo', created_at: '2026-01-01T00:00:00Z' }
  const client = (rpc: (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown }) =>
    ({ rpc: async (name: string, args: Record<string, unknown>) => rpc(name, args) }) as unknown as SupabaseClient

  it('returns the fuzzy match once find_similar_venue answers', async () => {
    const db = client((name, args) => name === 'find_similar_venue'
      ? { data: [{ id: 'sala', name: 'Sala  Sintética', similarity: 0.9 }], error: null }
      : { data: venueNameKey(String(args.p_name)) === 'sala sintetica' ? [{ venue: sala, event_count: 4 }] : [], error: null })
    expect(await Effect.runPromise(matchVenueEffect('Sala Sintetica Bar', 0.6, db)))
      .toMatchObject({ matchType: 'fuzzy', confidence: 0.9, venue: { id: 'sala' } })
  })

  it('fails instead of reporting no match when a lookup errors', async () => {
    const db = client(() => ({ data: null, error: { message: 'structure of query does not match function result type' } }))
    await expect(Effect.runPromise(matchVenueEffect('Sala Sintética', 0.6, db))).rejects.toThrow('structure of query')
  })
})

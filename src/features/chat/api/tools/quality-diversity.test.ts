import { describe, expect, it } from 'vitest'
import { chillRerank, type SearchScoreable } from './quality-diversity.ts'

// Minimal SearchScoreable fixtures. `facets` is optional on the interface so
// untagged events exercise the "missing facets → 0" branch, and `null` facets
// exercise the explicit-null branch.
const base = {
  id: '',
  name: '',
  starts_at: '2026-12-20T11:00:00.000Z',
  image_url: null,
  venue_id: null,
  venue_name: null,
  location_tba: false,
  description_unavailable: false,
  categories: [],
} satisfies SearchScoreable

function mk(
  id: string,
  facets: SearchScoreable['facets'] | undefined
): SearchScoreable {
  return { ...base, id, name: id, facets }
}

const partyHigh = mk('party-high', {
  vibes: ['energetic'],
  energy: 'high',
  eventType: ['party'],
})

const untaggedMissing = mk('untagged-missing', undefined)
const untaggedNull = mk('untagged-null', null)
const untaggedEmpty = mk('untagged-empty', {})

const relaxedLow = mk('relaxed-low', {
  vibes: ['relaxed'],
  energy: 'low',
  eventType: ['class'],
})

const intimateClass = mk('intimate-class', {
  vibes: ['intimate'],
  energy: 'medium',
  eventType: ['exhibition'],
})

describe('chillRerank', () => {
  it('puts a relaxed-low event before untagged and party-high', () => {
    const out = chillRerank([partyHigh, untaggedMissing, relaxedLow])
    expect(out.map((e) => e.id)).toEqual(['relaxed-low', 'untagged-missing', 'party-high'])
  })

  it('does not drop any event (ranking, not filtering)', () => {
    const input = [partyHigh, untaggedMissing, relaxedLow]
    const out = chillRerank(input)
    expect(out).toHaveLength(input.length)
    // The party loses to the relaxed event but is still present.
    expect(out.map((e) => e.id)).toContain('party-high')
    expect(out.map((e) => e.id)).toContain('relaxed-low')
  })

  it('keeps untagged events in their original relative order (score 0)', () => {
    const out = chillRerank([untaggedMissing, untaggedNull, untaggedEmpty])
    expect(out.map((e) => e.id)).toEqual([
      'untagged-missing',
      'untagged-null',
      'untagged-empty',
    ])
  })

  it('is stable for equal scores', () => {
    const a = mk('a', { vibes: ['relaxed'], eventType: ['class'] })
    const b = mk('b', { vibes: ['intimate'], eventType: ['exhibition'] })
    // Both score +2 (vibe) +1 (eventType) = +3 — ties must keep input order.
    const out = chillRerank([a, b])
    expect(out.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('sinks high-energy parties below calmer classes/exhibitions', () => {
    // party-high: -3 (party) -2 (high) -1 (energetic) = -6
    // intimate-class: +2 (intimate) +1 (exhibition) = +3
    const out = chillRerank([partyHigh, intimateClass])
    expect(out.map((e) => e.id)).toEqual(['intimate-class', 'party-high'])
  })
})

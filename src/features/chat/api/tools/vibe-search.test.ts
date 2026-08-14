import { describe, expect, it } from 'vitest'
import {
  detectVibeIntent,
  normalizeText,
  rankVibeMatches,
  scoreEventVibe,
  MIN_CONTENT_SCORE,
} from './vibe-search'
import { VIBE_FIXTURES } from '../../../../../evals/search/vibe-fixtures'
import { VIBE_GOLDEN_QUERIES } from '../../../../../evals/search/vibe-golden'

const byId = (ids: string[]) => ids.map((id) => VIBE_FIXTURES.find((event) => event.id === id)!)

describe('normalizeText', () => {
  it('lowercases, strips diacritics and collapses punctuation', () => {
    expect(normalizeText('Ortúzar, "PLANES" tranqui!')).toBe('ortuzar planes tranqui')
  })
})

describe('detectVibeIntent', () => {
  it('detects chill signals in English and Spanish', () => {
    expect(detectVibeIntent('chill vibes')?.chill).toBe(true)
    expect(detectVibeIntent('planes tranqui')?.chill).toBe(true)
    expect(detectVibeIntent('algo relajado para hacer')?.chill).toBe(true)
  })

  it('detects techno, free and date-like signals bilingually', () => {
    expect(detectVibeIntent('underground techno')?.techno).toBe(true)
    expect(detectVibeIntent('eventos gratis')?.free).toBe(true)
    expect(detectVibeIntent('free events')?.free).toBe(true)
    expect(detectVibeIntent('romantic date')?.date).toBe(true)
    expect(detectVibeIntent('plan para una cita')?.date).toBe(true)
  })

  it('detects neighborhood, weekday and weekend signals', () => {
    const palermo = detectVibeIntent('things to do in palermo')
    expect(palermo?.neighborhood).toBe('Palermo')
    const sanTelmo = detectVibeIntent('planes en san telmo')
    expect(sanTelmo?.neighborhood).toBe('San Telmo')
    const urquiza = detectVibeIntent('urquiza')
    expect(urquiza?.neighborhood).toBe('Villa Urquiza')
    expect(detectVibeIntent('techno party saturday')?.dayOfWeek).toBe(6)
    expect(detectVibeIntent('weekend plans')?.weekend).toBe(true)
    expect(detectVibeIntent('el finde')?.weekend).toBe(true)
  })

  it('returns null for non-vibe (semantic) queries', () => {
    expect(detectVibeIntent('tango dancing class')).toBeNull()
    expect(detectVibeIntent('bbq smoked meats festival')).toBeNull()
    expect(detectVibeIntent('tech talks engineering networking')).toBeNull()
  })
})

describe('scoreEventVibe', () => {
  it('reports keyword, signals, strong and context components', () => {
    const intent = detectVibeIntent('underground techno')!
    const techno = byId(['techno-fabrik'])[0]
    const breakdown = scoreEventVibe(techno, 'underground techno', intent)
    expect(breakdown.keyword).toBeGreaterThan(0)
    expect(breakdown.strong).toBeGreaterThan(0)
    expect(breakdown.total).toBeGreaterThan(0)
    // The genre text evidence must qualify the event on its own.
    expect(breakdown.keyword + breakdown.strong).toBeGreaterThanOrEqual(MIN_CONTENT_SCORE)
  })

  it('penalizes a loud party under a chill intent (opposing signals)', () => {
    const intent = detectVibeIntent('chill vibes')!
    const reggaeton = byId(['reggaeton-bar'])[0]
    const yoga = byId(['yoga-palermo'])[0]
    const loud = scoreEventVibe(reggaeton, 'chill vibes', intent)
    const calm = scoreEventVibe(yoga, 'chill vibes', intent)
    expect(calm.total).toBeGreaterThan(loud.total)
  })
})

describe('rankVibeMatches (labeled bilingual golden set)', () => {
  it.each(VIBE_GOLDEN_QUERIES)(
    '$query',
    ({ query, relevant, irrelevant, top }) => {
      const intent = detectVibeIntent(query)
      expect(intent, `"${query}" must be routed as a vibe query`).not.toBeNull()
      const { events } = rankVibeMatches(VIBE_FIXTURES, query, intent!, 10)
      const returned = new Set(events.map((event) => event.id))

      for (const id of relevant) {
        expect(returned.has(id), `"${query}" must return ${id}`).toBe(true)
      }
      for (const id of irrelevant) {
        expect(returned.has(id), `"${query}" must NOT return ${id}`).toBe(false)
      }
      if (top) {
        expect(events[0]?.id, `"${query}" must rank ${top} first`).toBe(top)
      }
    }
  )
})

describe('fewer results when relevance is poor', () => {
  it('returns zero events when no candidate clears the strong-evidence gate', () => {
    const loudCorpus = byId(['techno-fabrik', 'reggaeton-bar', 'maraton'])
    const intent = detectVibeIntent('chill evening')!
    const { events, relevantCount } = rankVibeMatches(loudCorpus, 'chill evening', intent, 3)
    expect(events).toHaveLength(0)
    expect(relevantCount).toBe(0)
  })

  it('never exceeds the requested limit', () => {
    const intent = detectVibeIntent('free events')!
    const { events } = rankVibeMatches(VIBE_FIXTURES, 'free events', intent, 2)
    expect(events.length).toBeLessThanOrEqual(2)
    // The three free fixtures exist; the cap truncates rather than pads.
    expect(events.length).toBe(2)
  })

  it('keeps every candidate of the named neighborhood for context-only queries', () => {
    const intent = detectVibeIntent('things to do in palermo')!
    const { events, relevantCount } = rankVibeMatches(VIBE_FIXTURES, 'things to do in palermo', intent, 10)
    // No content gate applies (no vibe signal), but events known to be in
    // OTHER neighborhoods are excluded — the browse is constrained to Palermo.
    expect(relevantCount).toBe(4)
    const palermoIds = VIBE_FIXTURES.filter((event) => event.venue_neighborhood === 'Palermo')
      .map((event) => event.id)
      .sort()
    expect(
      events
        .filter((event) => event.venue_neighborhood === 'Palermo')
        .map((event) => event.id)
        .sort()
    ).toEqual(palermoIds)
    expect(events).toHaveLength(4)
  })
})

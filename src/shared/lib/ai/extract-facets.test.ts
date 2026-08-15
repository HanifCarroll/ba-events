import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

import { generateObject } from 'ai'
import { extractEventFacets } from './extract-facets.ts'
import {
  eventFacetsSchema,
  parseEventFacets,
  isEmptyFacets,
  EMPTY_FACETS,
} from '#shared/lib/search-facets.ts'

const generateObjectMock = generateObject as unknown as Mock

describe('eventFacetsSchema', () => {
  beforeEach(() => {
    generateObjectMock.mockReset()
  })

  it('accepts a fully-empty object (all arrays default to [])', () => {
    const parsed = eventFacetsSchema.parse({})
    for (const key of ['eventType', 'genres', 'activities', 'vibes', 'audience', 'setting'] as const) {
      expect(parsed[key]).toEqual([])
    }
    expect(parsed.energy).toBeUndefined()
    expect(parsed.socialInteraction).toBeUndefined()
  })

  it('rejects an unknown genre', () => {
    expect(() => parseEventFacets({ genres: ['disco'] })).toThrow()
  })

  it('rejects any value outside a closed enum', () => {
    expect(() => parseEventFacets({ vibes: ['chill-af'] })).toThrow()
    expect(() => parseEventFacets({ energy: 'turbo' })).toThrow()
  })

  it('accepts a value inside the closed vocabularies', () => {
    const parsed = parseEventFacets({
      genres: ['techno'],
      vibes: ['underground'],
      energy: 'high',
    })
    expect(parsed.genres).toEqual(['techno'])
    expect(parsed.vibes).toEqual(['underground'])
    expect(parsed.energy).toBe('high')
  })
})

describe('extractEventFacets', () => {
  beforeEach(() => {
    generateObjectMock.mockReset()
  })

  it('returns facets from the mocked generateObject (never calls DeepSeek)', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        eventType: ['concert'],
        genres: ['jazz'],
        activities: ['live-music'],
        vibes: ['intimate'],
        audience: ['friends'],
        setting: ['indoor', 'seated'],
        energy: 'low',
      },
    })

    const facets = await extractEventFacets({
      name: 'Noche de Jazz',
      description_es: 'Jazz en vivo íntimo.',
      description_en: 'Intimate live jazz.',
      categories: ['music'],
    })

    expect(facets.genres).toEqual(['jazz'])
    expect(facets.eventType).toEqual(['concert'])
    expect(facets.energy).toBe('low')
    // Closed enum enforced: the model only returned valid keys here.
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
    expect(generateObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: { deepseek: { thinking: { type: 'disabled' } } },
        prompt: expect.stringContaining('Classify this event'),
      })
    )
  })

  it('returns the literal empty object {} when generateObject fails', async () => {
    generateObjectMock.mockRejectedValue(new Error('boom'))

    const facets = await extractEventFacets({
      name: 'Event',
      description_es: 'Una descripción.',
      description_en: null,
      categories: null,
    })

    // Must be a literal {} — NOT the parsed default (six empty arrays), which
    // would make isEmptyFacets treat it as non-empty and block retry.
    expect(facets).toEqual({})
    expect(Object.keys(facets)).toHaveLength(0)
  })

  it('returns the literal empty object {} when there is no description to base them on', async () => {
    const facets = await extractEventFacets({
      name: 'Misterio',
      description_es: null,
      description_en: null,
    })
    expect(facets).toEqual({})
    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  it('persists a legitimately-empty model output as-is', async () => {
    generateObjectMock.mockResolvedValue({ object: {} })

    const facets = await extractEventFacets({
      name: 'Evento',
      description_es: 'Sin rasgos destacables.',
      description_en: 'Nothing notable.',
    })

    expect(facets).toEqual({})
  })
})

describe('isEmptyFacets', () => {
  it('treats the literal empty object {} as empty', () => {
    expect(isEmptyFacets({})).toBe(true)
  })

  it('treats the parsed default (all six arrays empty, no energy) as empty', () => {
    expect(isEmptyFacets(EMPTY_FACETS)).toBe(true)
  })

  it('treats an object with any populated array as non-empty', () => {
    expect(isEmptyFacets({ genres: ['jazz'] })).toBe(false)
    expect(isEmptyFacets(parseEventFacets({ energy: 'high' }))).toBe(false)
  })

  it('treats a partially-populated parsed-default as non-empty', () => {
    expect(
      isEmptyFacets(eventFacetsSchema.parse({ vibes: ['intimate'] }))
    ).toBe(false)
  })
})

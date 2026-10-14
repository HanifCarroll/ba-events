import { describe, expect, it } from 'vitest'
import { buildSearchDocument, generateEmbedding } from './embeddings.ts'

describe('query embedding cancellation', () => {
  it('passes cancellation to the actual embedding provider request without retrying', async () => {
    const originalFetch = globalThis.fetch
    const originalKey = process.env.OPENAI_API_KEY
    const controller = new AbortController()
    let received: AbortSignal | undefined
    let calls = 0
    let started: () => void = () => {}
    const ready = new Promise<void>((resolve) => { started = resolve })
    process.env.OPENAI_API_KEY = 'test-only-key'
    globalThis.fetch = async (_input, init) => {
      calls++
      received = init?.signal ?? undefined
      started()
      return new Promise<Response>((_resolve, reject) => {
        received!.addEventListener('abort', () => reject(received!.reason), { once: true })
      })
    }
    try {
      const running = generateEmbedding('cancellation-test-uncached-query', controller.signal)
      const outcome = running.then(() => ({ rejected: false }), () => ({ rejected: true }))
      await ready
      controller.abort()
      expect((await outcome).rejected).toBe(true)
      expect(received?.aborted).toBe(true)
      expect(calls).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
      if (originalKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = originalKey
    }
  })
})

describe('buildSearchDocument', () => {
  it('includes title, descriptions, categories, facets, venue, neighborhood, free/paid, and event type for a venued event', () => {
    const doc = buildSearchDocument({
      name: 'Techno Warehouse Party',
      description_es:
        'Fiesta de música electrónica en una bodega industrial con sistema de sonido potente.',
      description_en:
        'Electronic music party in an industrial warehouse with a powerful sound system.',
      categories: ['music'],
      price: 15000,
      is_free: false,
      venue_name: 'Niceto Club',
      venue_neighborhood: 'Palermo',
      facets: {
        eventType: ['party'],
        genres: ['techno', 'house'],
        activities: ['dancing'],
        vibes: ['underground'],
        audience: ['friends'],
        setting: ['standing'],
      },
    })

    expect(doc).toContain('Techno Warehouse Party')
    expect(doc).toContain('Fiesta de música electrónica')
    expect(doc).toContain('Electronic music party')
    expect(doc).toContain('music')
    expect(doc).toContain('Genres: techno, house')
    expect(doc).toContain('Activities: dancing')
    expect(doc).toContain('Vibes: underground')
    expect(doc).toContain('Event type: party')
    expect(doc).toContain('Niceto Club')
    expect(doc).toContain('in Palermo')
    // Paid event marks a non-free price as 15000 ARS (not "free event").
    expect(doc).toContain('15000 ARS')
    expect(doc).not.toContain('free event')
  })

  it('marks a free event explicitly', () => {
    const doc = buildSearchDocument({
      name: 'Open Air Park Party',
      description_es: 'Fiesta al aire libre gratis en el parque.',
      categories: ['music'],
      is_free: true,
    })
    expect(doc).toContain('Open Air Park Party')
    expect(doc).toContain('free event')
    expect(doc).not.toContain('paid event')
  })

  it('produces a usable document when facets and venue are absent (empty facets)', () => {
    const doc = buildSearchDocument({
      name: 'Muestra de Arte',
      description_es: 'Exposición de arte contemporáneo.',
      categories: ['arts'],
    })

    expect(doc).toContain('Muestra de Arte')
    expect(doc).toContain('Exposición de arte contemporáneo')
    expect(doc).toContain('arts')
    // No facet sections to attach; still a coherent doc that doesn't crash.
    expect(doc).not.toMatch(/Genres:/)
    // is_free is unknown here, so we must not label it a "paid event" (or free)
    // — that would be an ungrounded claim about cost.
    expect(doc).not.toMatch(/paid event|free event|ARS/)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('ai', () => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
}))

import { generateObject, generateText } from 'ai'
import { enrichEventFull, generateDescriptionSummary } from './enrichment.ts'

// The mocked module export IS the mock fn; cast only for typing
// (bun test does not provide vi.mocked).
const generateObjectMock = generateObject as unknown as Mock
const generateTextMock = generateText as unknown as Mock

describe('independent description and venue enrichment', () => {
  it('starts venue extraction alongside language detection and translates before the venue finishes', async () => {
    let releaseLanguage!: () => void
    let releaseVenue!: () => void
    const language = new Promise<void>((resolve) => { releaseLanguage = resolve })
    const venue = new Promise<void>((resolve) => { releaseVenue = resolve })
    const stages: string[] = []
    generateObjectMock.mockReset()
    generateTextMock.mockReset()
    generateObjectMock.mockImplementation(async ({ schema }: { schema: { shape: Record<string, unknown> } }) => {
      const field = Object.keys(schema.shape)[0]
      stages.push(field)
      if (field === 'language') { await language; return { object: { language: 'spanish' } } }
      if (field === 'venue_name') { await venue; return { object: { venue_name: 'Synthetic Venue' } } }
      return { object: { description: 'Jazz en vivo.' } }
    })
    generateTextMock.mockResolvedValue({ text: 'Live jazz.' })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Synthetic source markdown'))
    const running = enrichEventFull('https://example.com/event')
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(stages).toEqual(['language', 'venue_name'])
      releaseLanguage()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(generateTextMock).toHaveBeenCalledTimes(1)
      releaseVenue()
      expect(await running).toMatchObject({ description_es: 'Jazz en vivo.', description_en: 'Live jazz.', venue_name: 'Synthetic Venue', sourceObservedAt: expect.any(String) })
    } finally {
      releaseLanguage(); releaseVenue()
      await running
      fetchSpy.mockRestore()
    }
  })

  for (const venueName of ['Synthetic Venue', null]) {
    it(`preserves the venue-only/null fallback when description extraction fails (${venueName})`, async () => {
      generateTextMock.mockReset()
      generateObjectMock.mockImplementation(async ({ schema }: { schema: { shape: Record<string, unknown> } }) => ({
        object: 'venue_name' in schema.shape ? { venue_name: venueName } : { description: '' },
      }))
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Synthetic source markdown'))
      try {
        const result = await enrichEventFull('https://example.com/event', { knownLanguage: 'spanish' })
        expect(result).toEqual(venueName ? { description_es: null, description_en: null, venue_name: venueName, sourceObservedAt: expect.any(String) } : null)
        expect(generateTextMock).not.toHaveBeenCalled()
      } finally { fetchSpy.mockRestore() }
    })
  }
})

describe('generateDescriptionSummary', () => {
  beforeEach(() => {
    generateObjectMock.mockReset()
  })

  it('uses spanish summary prompt contract when language is spanish', async () => {
    generateObjectMock.mockResolvedValue({
      object: { summary: 'Fiesta electrónica íntima en Palermo.' },
    })

    const summary = await generateDescriptionSummary('Evento de música electrónica con DJs locales.', 'spanish')

    expect(summary).toBe('Fiesta electrónica íntima en Palermo.')
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
    expect(generateObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: { deepseek: { thinking: { type: 'disabled' } } },
        prompt: expect.stringContaining('Resume esta descripción de evento'),
      })
    )
  })

  it('uses english summary prompt contract when language is english', async () => {
    generateObjectMock.mockResolvedValue({
      object: { summary: 'Cozy live jazz session with local artists.' },
    })

    const summary = await generateDescriptionSummary('Live jazz with an intimate atmosphere.', 'english')

    expect(summary).toBe('Cozy live jazz session with local artists.')
    expect(generateObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Summarize this event description'),
      })
    )
  })

  it('enforces 180-char summary maximum in return value', async () => {
    generateObjectMock.mockResolvedValue({
      object: { summary: 'A'.repeat(220) },
    })

    const summary = await generateDescriptionSummary('Some long source description', 'english')

    expect(summary).not.toBeNull()
    expect(summary!.length).toBeLessThanOrEqual(180)
    expect(summary!.endsWith('…')).toBe(true)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('ai', () => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
}))

import { generateObject } from 'ai'
import { generateDescriptionSummary } from './enrichment'

// The mocked module export IS the mock fn; cast only for typing
// (bun test does not provide vi.mocked).
const generateObjectMock = generateObject as unknown as Mock

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

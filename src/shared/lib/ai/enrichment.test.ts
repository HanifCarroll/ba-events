import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateObjectMock = vi.hoisted(() => vi.fn())

vi.mock('ai', () => ({
  generateObject: generateObjectMock,
  generateText: vi.fn(),
}))

import { generateDescriptionSummary } from './enrichment'

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

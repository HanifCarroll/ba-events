import { beforeEach, describe, expect, it, vi } from 'vitest'

const structuredCreateMock = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    beta = {
      messages: {
        create: structuredCreateMock,
      },
    }
    messages = {
      create: vi.fn(),
    }
  }

  return {
    default: MockAnthropic,
  }
})

import { generateDescriptionSummary } from './enrichment'

describe('generateDescriptionSummary', () => {
  beforeEach(() => {
    structuredCreateMock.mockReset()
  })

  it('uses spanish summary prompt contract when language is spanish', async () => {
    structuredCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"summary":"Fiesta electrónica íntima en Palermo."}' }],
    })

    const summary = await generateDescriptionSummary('Evento de música electrónica con DJs locales.', 'spanish')

    expect(summary).toBe('Fiesta electrónica íntima en Palermo.')
    expect(structuredCreateMock).toHaveBeenCalledTimes(1)
    expect(structuredCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        output_format: expect.objectContaining({
          type: 'json_schema',
        }),
        messages: [
          expect.objectContaining({
            content: expect.stringContaining('Resume esta descripción de evento'),
          }),
        ],
      })
    )
  })

  it('uses english summary prompt contract when language is english', async () => {
    structuredCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"summary":"Cozy live jazz session with local artists."}' }],
    })

    const summary = await generateDescriptionSummary('Live jazz with an intimate atmosphere.', 'english')

    expect(summary).toBe('Cozy live jazz session with local artists.')
    expect(structuredCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: expect.stringContaining('Summarize this event description'),
          }),
        ],
      })
    )
  })

  it('enforces 180-char summary maximum in return value', async () => {
    const longSummary = 'A'.repeat(220)
    structuredCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ summary: longSummary }) }],
    })

    const summary = await generateDescriptionSummary('Some long source description', 'english')

    expect(summary).not.toBeNull()
    expect(summary!.length).toBeLessThanOrEqual(180)
    expect(summary!.endsWith('…')).toBe(true)
  })
})

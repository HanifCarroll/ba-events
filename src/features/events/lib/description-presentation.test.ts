import { describe, expect, it } from 'vitest'
import {
  buildDisplayDescription,
  buildFallbackSummary,
  pickDescriptionSummary,
  pickDisplayDescription,
} from './description-presentation'

describe('description presentation helpers', () => {
  it('preserves paragraph boundaries while cleaning html', () => {
    const input = `
      <p>First paragraph with <strong>detail</strong>.</p>
      <p>Second paragraph line one.<br/>Line two.</p>
    `

    const output = buildDisplayDescription(input)
    expect(output).toBe(
      'First paragraph with detail.\n\nSecond paragraph line one. Line two.'
    )
  })

  it('removes known noisy semantic description prefixes', () => {
    const input = 'Semantic description for indexing: Intimate jazz night in Palermo.'
    const output = buildDisplayDescription(input)
    expect(output).toBe('Intimate jazz night in Palermo.')
  })

  it('builds short summary fallback from first sentence', () => {
    const input =
      'An energetic indie concert with local bands and visual art installations. Bring friends.\n\nFood trucks on site.'
    const output = buildFallbackSummary(input, 120)
    expect(output).toBe(
      'An energetic indie concert with local bands and visual art installations.'
    )
  })

  it('uses locale-first summary fallback chain', () => {
    const summary = pickDescriptionSummary(
      {
        description_summary_es: 'Fiesta electrónica íntima en un espacio industrial.',
        description_summary_en: 'Intimate electronic party in an industrial venue.',
      },
      'es'
    )
    expect(summary).toBe('Fiesta electrónica íntima en un espacio industrial.')
  })

  it('falls back to cleaned display text when explicit display fields are absent', () => {
    const display = pickDisplayDescription(
      {
        description_en: '<p>Hands-on pottery workshop.</p><p>All materials included.</p>',
      },
      'en'
    )
    expect(display).toBe('Hands-on pottery workshop.\n\nAll materials included.')
  })
})

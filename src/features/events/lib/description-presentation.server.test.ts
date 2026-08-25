import { describe, expect, it, vi } from 'vitest'
import { buildDescriptionPresentationFields } from './description-presentation.server.ts'

describe('bilingual description presentation', () => {
  it('translates a generated source summary instead of the full description', async () => {
    const generateSummary = vi.fn(async () => 'Fiesta íntima de música electrónica.')
    const translate = vi.fn(async () => 'An intimate electronic music party.')

    const result = await buildDescriptionPresentationFields(
      {
        description_es: 'Una descripción larga en español.',
        description_en: null,
      },
      { generateSummary, translate },
    )

    expect(generateSummary).toHaveBeenCalledWith('Una descripción larga en español.', 'spanish')
    expect(translate).toHaveBeenCalledWith('Fiesta íntima de música electrónica.', 'es-to-en')
    expect(result.description_summary_es).toBe('Fiesta íntima de música electrónica.')
    expect(result.description_summary_en).toBe('An intimate electronic music party.')
  })
})

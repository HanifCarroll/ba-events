import { generateDescriptionSummary, translateText } from '#shared/lib/ai/enrichment.ts'
import { buildDisplayDescription } from './description-presentation.ts'

export interface DescriptionPresentationFields {
  description_display_es: string | null
  description_display_en: string | null
  description_summary_es: string | null
  description_summary_en: string | null
}

/**
 * Build all structured description fields from source-language descriptions.
 * Summaries are AI-generated and may return null on model failures.
 */
export async function buildDescriptionPresentationFields(
  input: {
    description_es?: string | null
    description_en?: string | null
  },
  dependencies: {
    generateSummary?: typeof generateDescriptionSummary
    translate?: typeof translateText
  } = {},
): Promise<DescriptionPresentationFields> {
  const generateSummary = dependencies.generateSummary ?? generateDescriptionSummary
  const translate = dependencies.translate ?? translateText
  const descriptionDisplayEs = buildDisplayDescription(input.description_es)
  const descriptionDisplayEn = buildDisplayDescription(input.description_en)

  const [descriptionSummaryEs, descriptionSummaryEn] = await Promise.all([
    descriptionDisplayEs ? generateSummary(descriptionDisplayEs, 'spanish') : Promise.resolve(null),
    descriptionDisplayEn ? generateSummary(descriptionDisplayEn, 'english') : Promise.resolve(null),
  ])

  const [translatedSummaryEn, translatedSummaryEs] = await Promise.all([
    !descriptionDisplayEn && descriptionSummaryEs ? translate(descriptionSummaryEs, 'es-to-en') : Promise.resolve(null),
    !descriptionDisplayEs && descriptionSummaryEn ? translate(descriptionSummaryEn, 'en-to-es') : Promise.resolve(null),
  ])

  return {
    description_display_es: descriptionDisplayEs,
    description_display_en: descriptionDisplayEn,
    description_summary_es: descriptionSummaryEs ?? translatedSummaryEs,
    description_summary_en: descriptionSummaryEn ?? translatedSummaryEn,
  }
}

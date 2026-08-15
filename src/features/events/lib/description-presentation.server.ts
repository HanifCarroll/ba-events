import { generateDescriptionSummary } from '#shared/lib/ai/enrichment.ts'
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
export async function buildDescriptionPresentationFields(input: {
  description_es?: string | null
  description_en?: string | null
}): Promise<DescriptionPresentationFields> {
  const descriptionDisplayEs = buildDisplayDescription(input.description_es)
  const descriptionDisplayEn = buildDisplayDescription(input.description_en)

  const [descriptionSummaryEs, descriptionSummaryEn] = await Promise.all([
    descriptionDisplayEs ? generateDescriptionSummary(descriptionDisplayEs, 'spanish') : Promise.resolve(null),
    descriptionDisplayEn ? generateDescriptionSummary(descriptionDisplayEn, 'english') : Promise.resolve(null),
  ])

  return {
    description_display_es: descriptionDisplayEs,
    description_display_en: descriptionDisplayEn,
    description_summary_es: descriptionSummaryEs,
    description_summary_en: descriptionSummaryEn,
  }
}

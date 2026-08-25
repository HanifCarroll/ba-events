/**
 * Rerank comparison variants for the offline search relevance eval.
 *
 * Adapters from the frozen corpus (`CorpusEvent`) into the shapes the real
 * hosted Voyage reranker consumes.
 */

import type { RerankDocumentEvent } from '#shared/lib/search/rerank.ts'
import type { CorpusEvent } from '../corpus/types.ts'

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const out = value.filter((v): v is string => typeof v === 'string')
    return out.length > 0 ? out : undefined
  }
  if (typeof value === 'string' && value.trim().length > 0) return [value]
  return undefined
}

/** Map the corpus's loose facet hashmap onto rerank-document facets. */
function corpusFacets(facets: Record<string, unknown>) {
  return {
    genres: asStringArray(facets.genres),
    vibes: asStringArray(facets.vibes) ?? asStringArray(facets.vibe),
    activities: asStringArray(facets.activities) ?? asStringArray(facets.activity),
    audience: asStringArray(facets.audience) ?? asStringArray(facets.audiences),
    setting: asStringArray(facets.setting) ?? asStringArray(facets.settings),
  }
}

export function corpusToRerankDocument(e: CorpusEvent): RerankDocumentEvent {
  const f = corpusFacets(e.facets ?? {})
  return {
    id: e.id,
    name: e.name,
    venue_name: e.venue?.name ?? null,
    venue_neighborhood: e.venue?.neighborhood ?? null,
    categories: e.categories,
    facets: {
      genres: f?.genres,
      vibes: f?.vibes,
      activities: f?.activities,
      audience: f?.audience,
      setting: f?.setting,
    },
    starts_at: e.starts_at,
    is_free: e.is_free,
    price: e.price,
    description_summary_es: e.descriptions.es_summary ?? null,
    description_summary_en: e.descriptions.en_summary ?? null,
    description_es: e.descriptions.es ?? null,
  }
}

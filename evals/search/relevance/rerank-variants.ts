/**
 * Rerank comparison variants for the offline search relevance eval.
 *
 * Adapters from the frozen corpus (`CorpusEvent`) into the shapes the real
 * rerankers consume, plus the production-equivalent facet/chill rerank that the
 * hosted Voyage reranker replaced on the production path.
 */

import {
  chillRerank,
  preferRerank,
  type SearchScoreable,
} from '#features/chat/api/tools/quality-diversity.ts'
import {
  detectChillIntent,
  preferIsEmpty,
  type EventSearchPrefer,
} from '#features/chat/api/tools/search-intent.ts'
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

const ENERGY_VALUES = ['low', 'medium', 'high'] as const
type Energy = (typeof ENERGY_VALUES)[number]

function asEnergy(value: unknown): Energy | undefined {
  if (typeof value === 'string' && (ENERGY_VALUES as readonly string[]).includes(value)) {
    return value as Energy
  }
  return undefined
}

/** Map the corpus's loose facet hashmap onto SearchScoreable facets. */
function corpusFacets(facets: Record<string, unknown>): SearchScoreable['facets'] {
  return {
    genres: asStringArray(facets.genres),
    vibes: asStringArray(facets.vibes) ?? asStringArray(facets.vibe),
    activities: asStringArray(facets.activities) ?? asStringArray(facets.activity),
    audience: asStringArray(facets.audience) ?? asStringArray(facets.audiences),
    setting: asStringArray(facets.setting) ?? asStringArray(facets.settings),
    energy: asEnergy(facets.energy),
    eventType: asStringArray(facets.eventType) ?? asStringArray(facets.event_type),
  }
}

/** CorpusEvent → SearchScoreable (for the facet/chill comparison variant). */
export function corpusToScoreable(e: CorpusEvent): SearchScoreable {
  return {
    id: e.id,
    name: e.name,
    starts_at: e.starts_at,
    image_url: e.image_url,
    venue_id: e.venue?.id ?? null,
    venue_name: e.venue?.name ?? null,
    location_tba: e.location_tba,
    description_unavailable: false,
    categories: e.categories,
    facets: corpusFacets(e.facets ?? {}),
  }
}

/** CorpusEvent → RerankDocumentEvent (for the hosted Voyage reranker). */
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

/** The production-equivalent facet/chill rerank that the hosted reranker replaced. */
export function facetRerank<T extends SearchScoreable>(
  events: T[],
  semanticQuery: string,
  prefer: EventSearchPrefer
): T[] {
  if (detectChillIntent(semanticQuery)) return chillRerank(events)
  if (!preferIsEmpty(prefer)) return preferRerank(events, prefer)
  return events
}

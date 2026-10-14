import { AI_MODEL, EMBEDDING_MODEL } from '#shared/lib/ai/constants.ts'
import { CURRENT_EMBEDDING_VERSION } from '#shared/lib/ai/embeddings.ts'

// Bump when enrichment prompts, extraction schemas or orchestration change.
export const ENRICHMENT_VERSION = 'event-enrichment-v1'
// Covers catalog transformers, categorization and presentation generation.
export const CATALOG_IMPORT_VERSION = 'catalog-import-v1'

/** Stored in existing scrape-run metadata, even when unchanged events need no writes. */
export interface CatalogImportProvenance {
  version: string
  scope: 'catalog'
  observedAt: string | null
  configuredTextModel: string
  configuredEmbeddingModel: string
  embeddingVersion: number
}

export function catalogImportProvenance(observedAt: string | null): CatalogImportProvenance {
  return {
    version: CATALOG_IMPORT_VERSION, scope: 'catalog', observedAt,
    configuredTextModel: AI_MODEL, configuredEmbeddingModel: EMBEDDING_MODEL,
    embeddingVersion: CURRENT_EMBEDDING_VERSION,
  }
}

export interface EnrichmentStageRecord {
  version: string
  textModel: string
  processedAt: string
  sourceMode: 'stored_description' | 'detail'
  sourceObservedAt: string | null
  sourceValidatedAt: string | null
  embeddingModel?: string
  embeddingVersion?: number
}

/** Latest successful full pass and facets backfill; failures use existing status/error fields. */
export interface EnrichmentProvenance {
  full?: EnrichmentStageRecord
  facets?: EnrichmentStageRecord
}

export function enrichmentStageRecord(
  sourceMode: EnrichmentStageRecord['sourceMode'],
  observation: { sourceObservedAt?: string | null; sourceValidatedAt?: string | null },
  embedded: boolean,
): EnrichmentStageRecord {
  return {
    version: ENRICHMENT_VERSION,
    textModel: AI_MODEL,
    processedAt: new Date().toISOString(),
    sourceMode,
    sourceObservedAt: observation.sourceObservedAt ?? null,
    sourceValidatedAt: observation.sourceValidatedAt ?? null,
    ...(embedded ? { embeddingModel: EMBEDDING_MODEL, embeddingVersion: CURRENT_EMBEDDING_VERSION } : {}),
  }
}

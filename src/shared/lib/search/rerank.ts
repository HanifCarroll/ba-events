/**
 * Hosted reranker for search_events stage-2.
 *
 * Calls the Voyage AI rerank API over compact per-event documents and orders
 * the candidates by the reranker's returned rank (rerankerRank ascending),
 * using the incoming retrieval (RRF) order only as a deterministic tie-break.
 * The reranker only REORDERS: it never drops candidates, never filters, and
 * has no score threshold — hard `must` constraints stay in SQL exactly as
 * today. Any failure (missing key, timeout, HTTP error, malformed response)
 * silently falls back to the pre-rerank candidate order.
 *
 * Server-side only: imported only from server code paths and offline evals.
 */

import type { EventSearchPrefer } from '#features/chat/api/tools/search-intent.ts'

const VOYAGE_RERANK_URL = 'https://api.voyageai.com/v1/rerank'
const RERANK_TIMEOUT_MS = 1200
const DEFAULT_MODEL = 'rerank-2.5-lite'

/** Hard cap for the whole built document, in characters. */
const DOC_CHAR_CAP = 600
/** Description fallback truncation, in characters. */
const DESCRIPTION_CHAR_CAP = 300

// ============================================================================
// TYPES
// ============================================================================

export interface RerankQueryInput {
  semanticQuery: string // may be ''
  prefer: EventSearchPrefer // from search-intent.ts
  avoid: string[] // raw avoid terms (soft context; genres already hard-excluded upstream)
}

export interface RerankDocumentEvent {
  id: string
  name: string
  venue_name: string | null
  venue_neighborhood: string | null
  categories: string[]
  facets?: {
    genres?: string[]
    vibes?: string[]
    activities?: string[]
    audience?: string[]
    setting?: string[]
  } | null
  starts_at: string
  is_free: boolean
  price: number | null
  // summaries / descriptions for the document body:
  description_summary_es?: string | null
  description_summary_en?: string | null
  description_es?: string | null // fallback when no summary; truncate to ~300 chars
  description_en?: string | null
}

export interface RerankMeta {
  status: 'applied' | 'disabled' | 'empty_query' | 'failed'
  model?: string
  latencyMs?: number
  totalTokens?: number
  error?: string
  // per-event diagnostics, keyed by event id (only when status === 'applied'):
  ranks?: Map<string, { baseRank: number; rerankerRank: number; rerankerScore: number; finalRank: number }>
}

// ============================================================================
// QUERY / DOCUMENT BUILDERS
// ============================================================================

const PREFER_FACET_KEYS = ['genres', 'vibes', 'activities', 'audience', 'setting'] as const

/**
 * Build the reranker query. Returns '' when there is nothing subjective to
 * rank against (empty semanticQuery AND empty prefer AND empty avoid).
 */
export function buildRerankQuery(input: RerankQueryInput): string {
  const semantic = input.semanticQuery?.trim() ?? ''

  const preferLines: string[] = []
  for (const key of PREFER_FACET_KEYS) {
    const values = input.prefer?.[key]
    if (values && values.length > 0) preferLines.push(`${key}: ${values.join(', ')}`)
  }

  const avoid = input.avoid ?? []
  const hasPrefer = preferLines.length > 0
  const hasAvoid = avoid.length > 0

  if (!semantic && !hasPrefer && !hasAvoid) return ''

  const lines: string[] = []
  lines.push(`Request: ${semantic || 'eventos en Buenos Aires'}`)
  if (hasPrefer) lines.push(`Preferences: ${preferLines.join('; ')}`)
  if (hasAvoid) lines.push(`Avoid: ${avoid.join(', ')}`)
  return lines.join('\n')
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max).trimEnd()
}

/** Summary line body: es summary, else en summary, else truncated description. */
function pickSummary(e: RerankDocumentEvent): string | null {
  const es = e.description_summary_es?.trim()
  if (es) return es
  const en = e.description_summary_en?.trim()
  if (en) return en
  const descEs = e.description_es?.trim()
  if (descEs) return truncate(descEs, DESCRIPTION_CHAR_CAP)
  const descEn = e.description_en?.trim()
  if (descEn) return truncate(descEn, DESCRIPTION_CHAR_CAP)
  return null
}

/**
 * Build a compact labeled document. One line per present field; absent fields
 * contribute NO text and must never read as a negative signal.
 */
export function buildRerankDocument(e: RerankDocumentEvent): string {
  const lines: string[] = []
  lines.push(`Name: ${e.name}`)

  const summary = pickSummary(e)
  if (summary) lines.push(`Summary: ${summary}`)

  if (e.venue_name) lines.push(`Venue: ${e.venue_name}`)
  if (e.venue_neighborhood) lines.push(`Neighborhood: ${e.venue_neighborhood}`)

  if (e.categories?.length) lines.push(`Categories: ${e.categories.join(', ')}`)

  const f = e.facets
  if (f?.genres?.length) lines.push(`Genres: ${f.genres.join(', ')}`)
  if (f?.vibes?.length) lines.push(`Vibes: ${f.vibes.join(', ')}`)
  if (f?.activities?.length) lines.push(`Activities: ${f.activities.join(', ')}`)
  if (f?.audience?.length) lines.push(`Audience: ${f.audience.join(', ')}`)
  if (f?.setting?.length) lines.push(`Setting: ${f.setting.join(', ')}`)

  lines.push(`Starts: ${e.starts_at}`)

  if (e.is_free) {
    lines.push('Cost: Free')
  } else if (e.price != null) {
    lines.push(`Cost: ${e.price} ARS`)
  }

  const full = lines.join('\n')
  return full.length <= DOC_CHAR_CAP ? full : full.slice(0, DOC_CHAR_CAP)
}

// ============================================================================
// RESPONSE VALIDATION
// ============================================================================

/**
 * `data` must be an array covering every input index exactly once, with a
 * numeric relevance_score per entry. Anything else is malformed.
 */
function isValidRerankData(
  data: unknown,
  n: number
): data is Array<{ index: number; relevance_score: number }> {
  if (!Array.isArray(data) || data.length !== n) return false
  const seen = new Set<number>()
  for (const item of data) {
    if (!item || typeof item !== 'object') return false
    const index = (item as { index?: unknown }).index
    const score = (item as { relevance_score?: unknown }).relevance_score
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= n) return false
    if (typeof score !== 'number' || Number.isNaN(score)) return false
    if (seen.has(index)) return false
    seen.add(index)
  }
  return seen.size === n
}

// ============================================================================
// RERANK
// ============================================================================

/**
 * Reorder candidates by the hosted Voyage reranker's rank (rerankerRank
 * ascending), using the incoming retrieval order (baseRank) only as a
 * deterministic tie-break. Never throws, never drops or duplicates.
 */
export async function rerankEvents<T extends { id: string }>(
  candidates: T[],
  queryInput: RerankQueryInput
): Promise<{ ordered: T[]; meta: RerankMeta }> {
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) {
    return { ordered: [...candidates], meta: { status: 'disabled' } }
  }

  const builtQuery = buildRerankQuery(queryInput)
  if (candidates.length <= 1 || !builtQuery) {
    return { ordered: [...candidates], meta: { status: 'empty_query' } }
  }

  const startedAt = performance.now()
  try {
    const model = process.env.VOYAGE_RERANK_MODEL ?? DEFAULT_MODEL
    const documents = candidates.map((c) => buildRerankDocument(c as unknown as RerankDocumentEvent))

    const response = await fetch(VOYAGE_RERANK_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: builtQuery, documents, model }),
      signal: AbortSignal.timeout(RERANK_TIMEOUT_MS),
    })

    const latencyMs = Math.round(performance.now() - startedAt)

    if (!response.ok) {
      return {
        ordered: [...candidates],
        meta: { status: 'failed', latencyMs, error: `Voyage rerank HTTP ${response.status}` },
      }
    }

    const json = (await response.json()) as Record<string, unknown>
    const data = json.data
    if (!isValidRerankData(data, candidates.length)) {
      return {
        ordered: [...candidates],
        meta: { status: 'failed', latencyMs, error: 'Voyage rerank returned malformed data' },
      }
    }

    const rerankerRankByInputIndex = new Map<number, number>()
    const scoreByInputIndex = new Map<number, number>()
    data.forEach((item, position) => {
      rerankerRankByInputIndex.set(item.index, position + 1)
      scoreByInputIndex.set(item.index, item.relevance_score)
    })

    const ranked = candidates.map((event, i) => {
      const baseRank = i + 1
      const rerankerRank = rerankerRankByInputIndex.get(i)!
      const rerankerScore = scoreByInputIndex.get(i)!
      return { event, baseRank, rerankerRank, rerankerScore }
    })

    ranked.sort((a, b) => {
      if (a.rerankerRank !== b.rerankerRank) return a.rerankerRank - b.rerankerRank
      return a.baseRank - b.baseRank
    })

    const ranks = new Map<string, { baseRank: number; rerankerRank: number; rerankerScore: number; finalRank: number }>()
    ranked.forEach((entry, position) => {
      ranks.set(entry.event.id, {
        baseRank: entry.baseRank,
        rerankerRank: entry.rerankerRank,
        rerankerScore: entry.rerankerScore,
        finalRank: position + 1,
      })
    })

    const usage = json.usage as { total_tokens?: number } | undefined
    return {
      ordered: ranked.map((entry) => entry.event),
      meta: {
        status: 'applied',
        model: (json.model as string | undefined) ?? model,
        latencyMs,
        totalTokens: usage?.total_tokens,
        ranks,
      },
    }
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt)
    return {
      ordered: [...candidates],
      meta: {
        status: 'failed',
        latencyMs,
        error: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

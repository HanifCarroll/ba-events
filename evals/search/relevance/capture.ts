#!/usr/bin/env bun
/**
 * Live-capture for the conclusive rerank eval.
 *
 * Freezes the PRODUCTION retrieval path for each live query: canonicalize the
 * input with a single real "now", mirror the search_events retrieval mode
 * (hybrid when a semantic query survives canonicalization, else filter-only),
 * then record the hosted Voyage rerank ranks as they stand at capture time.
 *
 * The frozen artifact (capture-latest.json) is what replay.ts scores offline
 * against LIVE_LABELS — no DB, no network, no env keys at replay time.
 *
 * Usage: bun evals/search/relevance/capture.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { LIVE_QUERIES } from './live-queries.ts'
import {
  canonicalizeSearchIntent,
  applyPreferAvoid,
  type EventSearchPrefer,
} from '#features/chat/api/tools/search-intent.ts'
import {
  hybridEventSearch,
  searchEventsWithFilters,
} from '#shared/lib/db/client.server.ts'
import { rerankEvents } from '#shared/lib/search/rerank.ts'
import { getNowInBA } from '#features/chat/api/tools/utils.ts'
import type { ChatEventPayload } from '#shared/lib/types.ts'

const OUT_PATH = new URL('./capture-latest.json', import.meta.url).pathname
const CANDIDATE_LIMIT = 50
// Payment method added → standard rate limits (no 3 RPM / 10K TPM ceiling).
// Modest pacing to stay polite; production makes one call per search.
const PACE_MS = 500
// A 429 means a transient window; a short backoff usually clears it now.
const RETRY_BACKOFFS = [2000, 5000]

// ============================================================================
// Frozen artifact shapes
// ============================================================================

interface FrozenEvent {
  id: string
  name: string
  starts_at: string
  is_free: boolean
  price: number | null
  min_age: number | null
  categories: string[]
  venue_id: string | null
  venue_name: string | null
  venue_neighborhood: string | null
  image_url: string | null
  location_tba: boolean
  description_unavailable: boolean
  description_summary_es: string | null
  description_summary_en: string | null
  description_es: string | null
  description_en: string | null
  facets: Record<string, unknown>
}

interface FrozenRank {
  baseRank: number
  rerankerRank: number
  rerankerScore: number
  finalRank: number
}

interface FrozenVoyage {
  status: string
  model?: string
  ranks?: Record<string, FrozenRank>
}

interface FrozenQueryEntry {
  id: string
  query: string
  subjective: boolean
  lang: 'es' | 'en' | 'mixed'
  hasMust: boolean
  path: 'semantic' | 'filter_only'
  semanticQuery: string
  prefer: EventSearchPrefer
  baseOrder: string[]
  voyage: FrozenVoyage
}

interface CaptureFile {
  meta: {
    capturedAt: string
    nowBA: string
    queries: number
  }
  events: Record<string, FrozenEvent>
  queries: FrozenQueryEntry[]
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** ChatEventPayload → the frozen shape both rerankers and the labeler need. */
function freezeEvent(e: ChatEventPayload): FrozenEvent {
  return {
    id: e.id,
    name: e.name,
    starts_at: e.starts_at,
    is_free: e.is_free,
    price: e.price,
    min_age: e.min_age,
    categories: e.categories ?? [],
    venue_id: e.venue_id ?? null,
    venue_name: e.venue_name ?? null,
    venue_neighborhood: e.venue_neighborhood ?? null,
    image_url: e.image_url ?? null,
    location_tba: e.location_tba,
    description_unavailable: e.description_unavailable,
    description_summary_es: e.description_summary_es ?? null,
    description_summary_en: e.description_summary_en ?? null,
    description_es: e.description_es ?? null,
    description_en: e.description_en ?? null,
    facets: (e.facets ?? {}) as unknown as Record<string, unknown>,
  }
}

/**
 * Production `rerankEvents` is fail-closed and does NOT retry. Eval-only retry
 * on free-tier 429s (backoff 5s / 15s / 30s), same pattern as run.ts.
 */
async function rerankWithRetry(
  candidates: ChatEventPayload[],
  semanticQuery: string,
  prefer: EventSearchPrefer
): Promise<ReturnType<typeof rerankEvents<ChatEventPayload>>> {
  let result = await rerankEvents(candidates, { semanticQuery, prefer, avoid: [] })
  for (const backoffMs of RETRY_BACKOFFS) {
    if (result.meta.status !== 'failed' || !result.meta.error?.includes('429')) break
    await sleep(backoffMs)
    result = await rerankEvents(candidates, { semanticQuery, prefer, avoid: [] })
  }
  return result
}

// ============================================================================
// Capture
// ============================================================================

const capturedAt = new Date()
const nowBA = getNowInBA()

const events: Record<string, FrozenEvent> = {}
const queries: FrozenQueryEntry[] = []

const pathCounts = { semantic: 0, filter_only: 0 }
const statusCounts = new Map<string, number>()

let nextAllowedAt = 0

for (let i = 0; i < LIVE_QUERIES.length; i++) {
  const q = LIVE_QUERIES[i]
  const input = { query: q.query, ...(q.toolInput ?? {}) }

  const intent = await canonicalizeSearchIntent(input, nowBA)
  if (intent.objective === 'surprise') {
    throw new Error(
      `live query ${q.id} canonicalized to objective=surprise; capture does not support the surprise path`
    )
  }

  const filters = applyPreferAvoid(intent)
  const path = intent.semanticQuery.trim() ? 'semantic' : 'filter_only'
  const candidates =
    path === 'semantic'
      ? await hybridEventSearch(intent.semanticQuery, filters, CANDIDATE_LIMIT)
      : await searchEventsWithFilters(filters, CANDIDATE_LIMIT)
  pathCounts[path] += 1

  // Pace Voyage calls so the capture measures reranker quality, not free-tier
  // 429 fallbacks. Production makes one call per search; this delay is
  // capture-only.
  const waitMs = nextAllowedAt - Date.now()
  if (waitMs > 0) await sleep(waitMs)
  const { meta } = await rerankWithRetry(candidates, intent.semanticQuery, intent.prefer)
  nextAllowedAt = Date.now() + PACE_MS

  statusCounts.set(meta.status, (statusCounts.get(meta.status) ?? 0) + 1)

  const baseOrder = candidates.map((e) => e.id)
  for (const e of candidates) {
    if (!events[e.id]) events[e.id] = freezeEvent(e)
  }

  queries.push({
    id: q.id,
    query: q.query,
    subjective: q.subjective,
    lang: q.lang,
    hasMust: q.hasMust,
    path,
    semanticQuery: intent.semanticQuery,
    prefer: intent.prefer,
    baseOrder,
    voyage:
      meta.status === 'applied'
        ? {
            status: meta.status,
            model: meta.model,
            ranks: Object.fromEntries(meta.ranks ?? new Map()),
          }
        : { status: meta.status },
  })

  console.error(
    `[${i + 1}/${LIVE_QUERIES.length}] ${q.id.padEnd(30)} path=${path.padEnd(11)} ` +
      `candidates=${String(candidates.length).padStart(2)} voyage=${meta.status}`
  )
  flush()
}
// ============================================================================
// Write
// ============================================================================

function buildOutput(): CaptureFile {
  return {
    meta: {
      capturedAt: capturedAt.toISOString(),
      nowBA: nowBA.toISOString(),
      queries: LIVE_QUERIES.length,
    },
    events,
    queries,
  }
}

// Persist after every query so an interrupt never loses completed work.
function flush(): void {
  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(buildOutput(), null, 2) + '\n')
}

console.log(`\n[capture] wrote ${queries.length} query entries, ${Object.keys(events).length} events → ${OUT_PATH}`)
console.log(`[capture] path   : semantic=${pathCounts.semantic} filter_only=${pathCounts.filter_only}`)
console.log(
  `[capture] voyage : ${[...statusCounts.entries()]
    .map(([status, count]) => `${status}=${count}`)
    .join(', ')}`
)

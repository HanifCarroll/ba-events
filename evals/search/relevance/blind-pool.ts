#!/usr/bin/env bun
/**
 * Deterministic blinded-pool utility.
 *
 * Turns a labeling worksheet (the pool.ts output) into a blinded judgment
 * worksheet plus a separate identity key:
 *   - For each query, the pool is shuffled with a stable PRNG (mulberry32).
 *     Math.random() is never used, so the same seed + worksheet reproduce the
 *     exact same artifact.
 *   - The blinded worksheet keeps the query metadata and complete event
 *     content needed to judge relevance, but replaces event UUIDs with opaque
 *     globally unique option IDs and leaves grade/rationale blank.
 *   - The blinded worksheet never exposes the event UUID, source ranker, rank,
 *     variant order, prior grade, or the original capture order.
 *   - The key separately maps option ID -> query ID / event ID.
 *
 * Usage:
 *   bun evals/search/relevance/blind-pool.ts
 *   bun evals/search/relevance/blind-pool.ts \
 *     --worksheet ./holdout-labeling-worksheet.json \
 *     --blind ./holdout-worksheet-blind.json \
 *     --key ./holdout-key.json \
 *     --seed 20260816
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { portablePath } from './portable-path.ts'

type Grade = 0 | 1 | 2 | 3

// ============================================================================
// CLI
// ============================================================================

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const worksheetArg = argValue('--worksheet')
const blindArg = argValue('--blind')
const keyArg = argValue('--key')
const seedArg = argValue('--seed')

const WORKSHEET_PATH = worksheetArg
  ? resolve(process.cwd(), worksheetArg)
  : new URL('./labeling-worksheet.json', import.meta.url).pathname
const BLIND_PATH = blindArg
  ? resolve(process.cwd(), blindArg)
  : new URL('./worksheet-blind.json', import.meta.url).pathname
const KEY_PATH = keyArg
  ? resolve(process.cwd(), keyArg)
  : new URL('./worksheet-key.json', import.meta.url).pathname

/** Documented deterministic default seed (no Math.random anywhere). */
const DEFAULT_SEED = 20260816
const SEED = seedArg === undefined ? DEFAULT_SEED : (() => {
  const n = Number(seedArg)
  if (!Number.isInteger(n)) {
    throw new Error(`--seed must be an integer, got: ${JSON.stringify(seedArg)}`)
  }
  return n
})()

// ============================================================================
// Worksheet shape (mirrors pool.ts output)
// ============================================================================

interface PoolEvent {
  eventId: string
  name: string
  starts_at: string | null
  venue: string | null
  neighborhood: string | null
  categories: string[]
  facets: Record<string, unknown>
  is_free: boolean | null
  price: number | null
  summary: string | null
  description: string | null
}

interface WorksheetQuery {
  queryId: string
  query: string
  semanticQuery: string
  subjective: boolean
  lang: string
  pool: PoolEvent[]
}

const worksheet = JSON.parse(readFileSync(WORKSHEET_PATH, 'utf-8')) as WorksheetQuery[]

// ============================================================================
// Deterministic PRNG (never Math.random)
// ============================================================================

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ============================================================================
// Build blinded worksheet + key
// ============================================================================

const rng = mulberry32(SEED)
let optionCounter = 0

const blindQueries: unknown[] = []
const keyQueries: unknown[] = []

for (const q of worksheet) {
  // Hard invariant: event IDs must be unique within a query's pool.
  const ids = q.pool.map((p) => p.eventId)
  const idSet = new Set(ids)
  if (idSet.size !== ids.length) {
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i)
    throw new Error(
      `worksheet query ${q.queryId} has duplicate event IDs in its pool: ${[...new Set(dup)].join(', ')}`
    )
  }

  // Deterministic shuffle hides the capture/retrieval order.
  const presented = shuffled(q.pool, rng)

  const blindOptions: unknown[] = []
  const keyOptions: unknown[] = []

  for (const e of presented) {
    const optionId = `op-${String(++optionCounter).padStart(4, '0')}`
    blindOptions.push({
      optionId,
      name: e.name,
      starts_at: e.starts_at,
      venue: e.venue,
      neighborhood: e.neighborhood,
      categories: e.categories,
      facets: e.facets,
      is_free: e.is_free,
      price: e.price,
      summary: e.summary,
      description: e.description,
      grade: null,
      rationale: '',
    })
    keyOptions.push({
      optionId,
      eventId: e.eventId,
    })
  }

  blindQueries.push({
    queryId: q.queryId,
    query: q.query,
    semanticQuery: q.semanticQuery,
    subjective: q.subjective,
    lang: q.lang,
    options: blindOptions,
  })

  keyQueries.push({
    queryId: q.queryId,
    options: keyOptions,
  })
}

const generatedAt = new Date().toISOString()

const blind = {
  meta: {
    generatedAt,
    seed: SEED,
    worksheet: portablePath(WORKSHEET_PATH),
    note:
      'Blinded pool worksheet. Option IDs are opaque; no event UUID, source ranker, rank, variant order, prior grade, or capture order is exposed. Fill grade (0..3) and rationale per option.',
  },
  queries: blindQueries,
}

const key = {
  meta: {
    generatedAt,
    seed: SEED,
    worksheet: portablePath(WORKSHEET_PATH),
    note: 'Restores identity for the blinded worksheet: optionId -> queryId / eventId.',
  },
  queries: keyQueries,
}

writeFileSync(BLIND_PATH, JSON.stringify(blind, null, 2) + '\n')
writeFileSync(KEY_PATH, JSON.stringify(key, null, 2) + '\n')

let totalOptions = 0
for (const bq of blindQueries) {
  totalOptions += (bq as { options: unknown[] }).options.length
}
console.log(
  `[blind-pool] ${blindQueries.length} queries, ${totalOptions} options → ${BLIND_PATH}`
)
console.log(`[blind-pool] key (${keyQueries.length} queries) → ${KEY_PATH}`)

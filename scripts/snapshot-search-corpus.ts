#!/usr/bin/env bun
/**
 * Snapshot the search corpus.
 *
 * Dumps scheduled upcoming events from the live DB into
 * `evals/search/corpus/events.json` as RAW fields (ids, names, descriptions,
 * categories, facets, venue, neighborhood, times, price, flags). No embeddings
 * are stored — Phase 6 rebuilds retrieval documents from these fields.
 *
 * Deterministic: rows are sorted by `id` before writing and `meta.generatedAt`
 * is a fixed placeholder, so re-running against a stable DB yields
 * byte-identical output (the real timestamp goes to stderr only).
 *
 * Fixture fallback is conservative:
 *   - `--fixture` writes the committed synthetic fixture (never a live dump).
 *   - A live-DB failure writes the fixture ONLY if `events.json` does not
 *     already exist. If the file exists, the run exits non-zero and leaves the
 *     committed file untouched (a live snapshot must not silently be replaced
 *     by the synthetic set).
 *
 * Usage:
 *   bun scripts/snapshot-search-corpus.ts [--limit 200] [--fixture]
 *
 * The relevance eval (bun evals/search/relevance/run.ts) runs OFFLINE against
 * this file and never touches the live events table.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { buildFixtureFile } from '../evals/search/corpus/fixture.ts'
import type { CorpusEvent, CorpusFile } from '../evals/search/corpus/types.ts'

const OUT_PATH = new URL('../evals/search/corpus/events.json', import.meta.url).pathname

/** Fixed timestamp so a live snapshot is byte-identical across runs. */
const FIXED_GENERATED_AT = '2026-08-01T00:00:00.000Z'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const LIMIT_FLAG = '--limit'
const limitArg = args.indexOf(LIMIT_FLAG) >= 0 ? args[args.indexOf(LIMIT_FLAG) + 1] : undefined
const limit = limitArg ? Math.max(1, Number(limitArg)) : 200
const forceFixture = args.includes('--fixture')

// ---------------------------------------------------------------------------
// Live DB dump (server-only, guarded by env). Returns null on failure.
// ---------------------------------------------------------------------------
async function dumpLive(limitN: number): Promise<CorpusFile | null> {
  try {
    const { getSupabase } = await import('#shared/lib/db/client.server.ts')
    const supabase = getSupabase()
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('events_with_venues')
      .select(
        [
          'id',
          'name',
          'description_es',
          'description_en',
          'description_summary_es',
          'description_summary_en',
          'categories',
          'starts_at',
          'is_free',
          'price',
          'image_url',
          'location_tba',
          'time_tba',
          'min_age',
          'venue_id',
          'venue_name',
          'venue_neighborhood',
        ].join(',')
      )
      .eq('status', 'scheduled')
      .gte('starts_at', now)
      .order('starts_at', { ascending: true })
      .order('id', { ascending: true }) // stable tie-breaker
      .limit(limitN)

    if (error) throw error
    if (!data || data.length === 0) throw new Error('no scheduled upcoming events returned')

    const events: CorpusEvent[] = (data as any[]).map((row) => ({
      id: row.id,
      name: row.name,
      descriptions: {
        es: row.description_es ?? null,
        en: row.description_en ?? null,
        es_summary: row.description_summary_es ?? null,
        en_summary: row.description_summary_en ?? null,
      },
      categories: row.categories ?? [],
      // `facets` is not selected: that column only exists from Phase 5.
      // Live dumps before Phase 5 omit it (falls back to {}); the fixture's
      // facets still ship via `--fixture` / FIXTURE_EVENTS.
      facets: row.facets ?? {},
      venue: {
        id: row.venue_id ?? null,
        name: row.venue_name ?? null,
        neighborhood: row.venue_neighborhood ?? null,
      },
      starts_at: row.starts_at,
      is_free: !!row.is_free,
      price: row.is_free ? 0 : (row.price ?? null),
      image_url: row.image_url ?? null,
      location_tba: !!row.location_tba,
      time_tba: !!row.time_tba,
      min_age: row.min_age ?? null,
    }))

    // Deterministic ordering so a stable DB yields byte-identical output.
    events.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    return {
      meta: {
        kind: 'snapshot',
        generatedAt: FIXED_GENERATED_AT,
        source: 'live events_with_venues dump',
      },
      events: events.slice(0, limitN),
    }
  } catch (err) {
    console.warn(`[snapshot-search-corpus] live DB unavailable: ${String(err)}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// Decide the corpus to write.
// ---------------------------------------------------------------------------
let corpus: CorpusFile | null = null
let wroteSnapshot = false

if (forceFixture || process.env.SNAPSHOT_SOURCE === 'fixture') {
  // Explicitly requested fixture — no live dump attempted, no --limit applied.
  corpus = buildFixtureFile()
} else {
  const live = await dumpLive(limit)
  if (live) {
    corpus = live
    wroteSnapshot = true
  } else if (existsSync(OUT_PATH)) {
    // Live dump failed but a committed snapshot already exists: do NOT clobber
    // it with the synthetic fixture. Failure is exit non-zero.
    console.error(
      `[snapshot-search-corpus] live dump failed and ${OUT_PATH} already exists — ` +
        `refusing to overwrite with synthetic fixture. Leaving the committed file alone.`
    )
    process.exit(1)
  } else {
    // No committed file and no live DB: write the fixture as a bootstrap.
    corpus = buildFixtureFile()
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------
mkdirSync(dirname(OUT_PATH), { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify(corpus, null, 2) + '\n')

console.error(
  `[snapshot-search-corpus] generated at ${new Date().toISOString()} (written to stderr only; the committed output stays byte-identical)`
)
if (wroteSnapshot) {
  console.log(`[snapshot-search-corpus] wrote ${corpus.events.length} events (snapshot, limit=${limit}) → ${OUT_PATH}`)
} else {
  console.log(
    `[snapshot-search-corpus] wrote ${corpus.events.length} events (${corpus.meta.kind}). Note: --limit=${limit} was NOT applied to the fixture — fixtures are written in full. → ${OUT_PATH}`
  )
}

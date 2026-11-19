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
 *   bun scripts/snapshot-search-corpus.ts [--limit 200] [--fixture] [--staging]
 *
 * The relevance eval (bun evals/search/relevance/run.ts) runs OFFLINE against
 * this file and never touches the live events table.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { buildFixtureFile } from '../evals/search/corpus/fixture.ts'
import type { CorpusEvent, CorpusFile } from '../evals/search/corpus/types.ts'
import { readD1, type ReadD1 } from './read-d1.ts'

const OUT_PATH = new URL('../evals/search/corpus/events.json', import.meta.url).pathname

/** Fixed timestamp so a live snapshot is byte-identical across runs. */
const FIXED_GENERATED_AT = '2026-08-01T00:00:00.000Z'

/** Read the raw corpus fields, with D1 JSON and integer booleans decoded at this boundary. */
export async function dumpLive(read: ReadD1, limit: number, now = new Date()): Promise<CorpusFile> {
  const data = await read<{
    id: string; name: string; description_es: string | null; description_en: string | null
    description_summary_es: string | null; description_summary_en: string | null
    categories: string; facets: string; starts_at: string; is_free: number; price: number | null
    image_url: string | null; location_tba: number; time_tba: number; min_age: number | null
    venue_id: string | null; venue_name: string | null; venue_neighborhood: string | null
  }>(`SELECT id, name, description_es, description_en, description_summary_es, description_summary_en,
    categories, facets, starts_at, is_free, price, image_url, location_tba, time_tba, min_age,
    venue_id, venue_name, venue_neighborhood FROM events_with_venues
    WHERE status = 'scheduled' AND starts_at >= ? ORDER BY starts_at, id LIMIT ?`, [now.toISOString(), limit])
  if (data.length === 0) throw new Error('no scheduled upcoming events returned')

  const events: CorpusEvent[] = data.map((row) => ({
    id: row.id,
    name: row.name,
    descriptions: {
      es: row.description_es ?? null,
      en: row.description_en ?? null,
      es_summary: row.description_summary_es ?? null,
      en_summary: row.description_summary_en ?? null,
    },
    categories: JSON.parse(row.categories ?? '[]'),
    facets: JSON.parse(row.facets ?? '{}'),
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
      source: 'live D1 events_with_venues dump',
    },
    events,
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const limitIndex = args.indexOf('--limit')
  const limit = limitIndex === -1 ? 200 : Number(args[limitIndex + 1])
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer')
  let corpus: CorpusFile
  if (args.includes('--fixture') || process.env.SNAPSHOT_SOURCE === 'fixture') {
    corpus = buildFixtureFile()
  } else {
    try { corpus = await dumpLive(readD1(args.includes('--staging')), limit) }
    catch {
      if (existsSync(OUT_PATH)) {
        console.error(`[snapshot-search-corpus] D1 read failed; leaving ${OUT_PATH} unchanged.`)
        process.exit(1)
      }
      console.warn('[snapshot-search-corpus] D1 read failed; creating a synthetic fixture.')
      corpus = buildFixtureFile()
    }
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(corpus, null, 2) + '\n')
  console.error(`[snapshot-search-corpus] generated at ${new Date().toISOString()}`)
  console.log(`[snapshot-search-corpus] wrote ${corpus.events.length} events (${corpus.meta.kind}) → ${OUT_PATH}`)
}

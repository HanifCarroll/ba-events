#!/usr/bin/env bun
/**
 * Captures real venue-name pairs and Postgres pg_trgm `similarity()` values from production into
 * `src/shared/lib/search/trigram.fixture.json`, so the TypeScript port in `trigram.ts` can be held equal to Postgres.
 *
 * Read-only: PostgREST GETs of `venues` and the STABLE functions `intake_similar_venues` and `find_similar_venue`,
 * with the service key from `.env` (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). Venue names are public business names.
 *
 * Usage: bun scripts/capture-trigram-fixture.ts
 */
import { writeFileSync } from 'node:fs'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
const OUT = new URL('../src/shared/lib/search/trigram.fixture.json', import.meta.url).pathname

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key!, Authorization: `Bearer ${key}` } })
  if (!response.ok) throw new Error(`GET ${path.split('?')[0]} failed: ${response.status} ${await response.text()}`)
  return response.json() as Promise<T>
}

const names: string[] = []
for (let offset = 0; ; offset += 1000) {
  const page = await get<Array<{ name: string }>>(`venues?select=name&order=id&offset=${offset}&limit=1000`)
  names.push(...page.map(row => row.name))
  if (page.length < 1000) break
}
names.sort()

// Queries: every 12th venue name as stored, plus variants an importer really sends (lowercased without accents, the
// first word or two, with a city suffix, with typos).
const strip = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '')
const queries = new Set<string>()
for (let index = 0; index < names.length; index += 12) {
  const name = names[index]
  const words = name.split(/\s+/)
  const variant = [
    name,
    strip(name).toLowerCase(),
    words.slice(0, 2).join(' '),
    `${name} - Buenos Aires`,
    name.length > 6 ? name.slice(0, -2) + name.slice(-1) : `${name}s`,
  ][(index / 12) % 5].trim()
  if (variant) queries.add(variant)
}

type Pair = { a: string; b: string; similarity: number; via: 'intake_similar_venues' | 'find_similar_venue' }
const pairs: Pair[] = []
const seen = new Set<string>()
const add = (pair: Pair) => {
  const id = `${pair.a}\u0000${pair.b}`
  // intake_similar_venues reports 1 for any case-insensitive equal name, so those pairs say nothing about similarity().
  if (seen.has(id) || (pair.via === 'intake_similar_venues' && pair.a.toLowerCase() === pair.b.toLowerCase())) return
  seen.add(id)
  pairs.push(pair)
}

for (const query of queries) {
  const ranked = await get<Array<{ name: string; similarity: number }>>(
    `rpc/intake_similar_venues?p_name=${encodeURIComponent(query)}&p_threshold=0&limit=1000`)
  // A spread of ranks, so the fixture covers exact, close, borderline, and unrelated names.
  for (const rank of [0, 1, 5, 400]) {
    const row = ranked[rank]
    if (row) add({ a: query, b: row.name, similarity: row.similarity, via: 'intake_similar_venues' })
  }
  if (pairs.length >= 450) break
}
for (const query of queries) {
  if (pairs.length >= 500) break
  const [best] = await get<Array<{ name: string; similarity: number }>>(
    `rpc/find_similar_venue?search_name=${encodeURIComponent(query)}&similarity_threshold=0`)
  if (best) add({ a: query, b: best.name, similarity: best.similarity, via: 'find_similar_venue' })
}

writeFileSync(OUT, `${JSON.stringify({
  captured: new Date().toISOString().slice(0, 10),
  source: 'production Postgres pg_trgm similarity(a, b), read through PostgREST',
  pairs: pairs.slice(0, 500),
}, null, 1)}\n`)
console.log(`wrote ${Math.min(pairs.length, 500)} pairs to ${OUT}`)

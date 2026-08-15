#!/usr/bin/env bun
/**
 * Re-embed events whose search document is stale (Phase 6).
 *
 * Selects scheduled events where `embedding_version < CURRENT_EMBEDDING_VERSION`
 * OR `search_document is null`, rebuilds the richer search document (title +
 * descriptions + categories + facets + venue + cost), re-embeds it, and writes
 * `embedding` + `search_document` + `embedding_version` in a single UPDATE so
 * the three can never drift apart.
 *
 * Idempotent: after a row is updated its `embedding_version` equals CURRENT and
 * its `search_document` is non-null, so a second run skips it.
 *
 * Usage:
 *   bun scripts/reembed-stale.ts [--limit 5]
 *
 * Requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY
 * (+ OPENAI_API_KEY for the embedding model). Pass `--limit N` for a smoke
 * run before the full backfill.
 *
 * Writes go through the service-role client: the anon role has no RLS UPDATE
 * on `events`, so anon writes are silently dropped. Reads may use anon.
 *
 * On an OpenAI error this stops and reports — it does not retry forever.
 */
import { getSupabase } from '#shared/lib/db/client.server.ts'
import { getSupabaseServiceRoleClient } from '#shared/lib/db/service.server.ts'
import { embedEventWithDocument, CURRENT_EMBEDDING_VERSION } from '#shared/lib/ai/embeddings.ts'

const DELAY_MS = 150

interface Args {
  limit: number
}

function parseArgs(argv: string[]): Args {
  const args: Args = { limit: Number.POSITIVE_INFINITY }
  const limitIdx = argv.indexOf('--limit')
  if (limitIdx >= 0 && argv[limitIdx + 1]) {
    const n = Number(argv[limitIdx + 1])
    if (!Number.isNaN(n)) args.limit = n
  }
  return args
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface StaleEventRow {
  id: string
  name: string
  description_es: string | null
  description_en: string | null
  categories: string[] | null
  facets: unknown
  price: number | null
  is_free: boolean
  venue_id: string | null
}

const PAGE_SIZE = 200

interface VenueInfo {
  name: string | null
  neighborhood: string | null
}

/**
 * Fetch stale events. When `limit` is finite, fetch exactly that many rows
 * total. When `limit` is not provided (all), paginate through the corpus in
 * PAGE_SIZE chunks (PostgREST rejects `.limit(Infinity)`).
 */
async function fetchStaleEvents(limit: number): Promise<StaleEventRow[]> {
  const rows: StaleEventRow[] = []

  // Base query — no .limit() until we know the parsed limit is finite.
  const buildQuery = () =>
    getSupabase()
      .from('events')
      .select(
        'id, name, description_es, description_en, categories, facets, price, is_free, venue_id, embedding_version, search_document'
      )
      .eq('status', 'scheduled')
      // Stale = built before the richer document schema, or never documented.
      .or(`embedding_version.lt.${CURRENT_EMBEDDING_VERSION},search_document.is.null`)
      .order('starts_at', { ascending: true })
      .order('id', { ascending: true })

  if (Number.isFinite(limit)) {
    const { data, error } = await buildQuery().limit(limit)
    if (error) throw new Error(`Failed to fetch stale events: ${error.message}`)
    return (data ?? []) as StaleEventRow[]
  }

  // No --limit: page through everything. PostgREST allows at most 1000 rows per
  // request, so page in blocks smaller than that. No arbitrary cap: a larger
  // catalog is never silently truncated, but we log when a full page ends the
  // loop so a suspicious boundary is still visible.
  let page = 0
  for (;;) {
    const { data, error } = await buildQuery().range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) throw new Error(`Failed to fetch stale events: ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...(data as StaleEventRow[]))
    if (data.length < PAGE_SIZE) break
    page += 1
  }
  if (rows.length % PAGE_SIZE === 0 && rows.length > 0) {
    console.warn(
      `[reembed-stale] last page (${PAGE_SIZE}) was full after ${rows.length} rows — there may be more stale events beyond this batch; rerun without a limit to confirm.`
    )
  }
  return rows
}

async function fetchVenueInfo(rows: StaleEventRow[]): Promise<Map<string, VenueInfo>> {
  const venueIds = [...new Set(rows.map((r) => r.venue_id).filter((v): v is string => !!v))]
  if (venueIds.length === 0) return new Map()

  const { data, error } = await getSupabase()
    .from('venues')
    .select('id, name, neighborhood')
    .in('id', venueIds)

  if (error) {
    throw new Error(`Failed to fetch venue info: ${error.message}`)
  }
  return new Map((data ?? []).map((v) => [v.id, { name: v.name, neighborhood: v.neighborhood }]))
}

async function main() {
  const limit = parseArgs(process.argv.slice(2)).limit
  const rows = await fetchStaleEvents(limit)

  console.log(
    `[reembed-stale] ${rows.length} stale scheduled events (embedding_version < ${CURRENT_EMBEDDING_VERSION} or null search_document), limit=${Number.isFinite(limit) ? limit : 'all'}`
  )

  if (rows.length === 0) {
    console.log('[reembed-stale] nothing to do.')
    return
  }

  const venueInfo = await fetchVenueInfo(rows)

  let updated = 0
  let failed = 0
  const seen = new Set<string>()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]

    // Idempotency guard for re-runs mid-batch: skip rows already processed.
    if (seen.has(row.id)) continue
    seen.add(row.id)

    const venue = row.venue_id ? venueInfo.get(row.venue_id) : undefined
    const event = {
      name: row.name,
      description_es: row.description_es,
      description_en: row.description_en,
      categories: row.categories ?? undefined,
      facets: row.facets as never,
      price: row.price,
      is_free: row.is_free,
      venue_name: row.venue_id ? venue?.name ?? null : null,
      venue_neighborhood: row.venue_id ? venue?.neighborhood ?? null : null,
    }

    try {
      const { embedding, searchDocument } = await embedEventWithDocument(event)

      // Write all three in one UPDATE via the service-role client (the anon
      // role has no RLS UPDATE on `events`, so anon writes are silently
      // dropped). The document is the exact text that was embedded, so
      // version + document + vector always agree.
      const { error: updateError } = await getSupabaseServiceRoleClient()
        .from('events')
        .update({
          embedding,
          search_document: searchDocument,
          embedding_version: CURRENT_EMBEDDING_VERSION,
        })
        .eq('id', row.id)

      if (updateError) throw updateError
      updated++
      console.log(`  ✓ ${row.id}\t${row.name}`)
    } catch (err) {
      failed++
      const message = (err as { message?: string }).message ?? String(err)
      // Embedding API failures (OpenAI) are non-transient enough that we stop
      // rather than hammer the provider; filter/update errors are also fatal
      // here because the corpus is small and a failed row is easy to re-run.
      console.error(`[reembed-stale] FAILED ${row.id}\t${row.name}\t${message}`)
      break
    }

    if (i < rows.length - 1) {
      await sleep(DELAY_MS)
    }
  }

  console.log(`[reembed-stale] updated ${updated}, failed ${failed}, total ${rows.length}`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(`[reembed-stale] fatal: ${String(err)}`)
  process.exit(1)
})

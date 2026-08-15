#!/usr/bin/env bun
/**
 * Backfill structured facets (Phase 5).
 *
 * Batches `extractEventFacets` for scheduled events whose `facets` is still
 * the empty default `{}`. Idempotent: rows with non-empty facets are skipped.
 *
 * By default this is a DRY-RUN: it prints the matching event ids and exits
 * without writing. Pass `--write` to persist facets. Either way only events
 * with empty `facets` are processed, and each extraction call is delayed by
 * `DELAY_MS` (200ms) to respect LLM rate limits.
 *
 * Usage:
 *   bun scripts/backfill-facets.ts [--limit 10] [--write] [--source passline]
 *
 * Requires SUPABASE_URL + SUPABASE_ANON_KEY in the environment. This script is
 * NOT executed by any unit test (no DeepSeek calls in tests).
 */
import { logger } from '@/shared/lib/logger'
import { getSupabase } from '@/shared/lib/db/client'
import { extractEventFacets } from '@/shared/lib/ai/extract-facets'
import { isEmptyFacets, type EventFacets } from '@/shared/lib/search-facets'

const DELAY_MS = 200

interface Args {
  limit: number
  write: boolean
  source?: string
}

function parseArgs(argv: string[]): Args {
  const args = { limit: 10, write: false } as Args
  const limitIdx = argv.indexOf('--limit')
  if (limitIdx >= 0 && argv[limitIdx + 1]) {
    args.limit = Math.max(1, Number(argv[limitIdx + 1]))
  }
  args.write = argv.includes('--write')
  const sourceIdx = argv.indexOf('--source')
  if (sourceIdx >= 0 && argv[sourceIdx + 1]) {
    args.source = argv[sourceIdx + 1]
  }
  return args
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface FacetRow {
  id: string
  name: string
  link: string | null
  source: string
  categories?: string[] | null
  description_es?: string | null
  description_en?: string | null
  facets: unknown
}

async function fetchEventsNeedingFacets(
  supabase: ReturnType<typeof getSupabase>,
  args: Args
): Promise<FacetRow[]> {
  let query = supabase
    .from('events')
    .select(
      'id, name, link, source, categories, description_es, description_en, facets'
    )
    .eq('status', 'scheduled')
    // Only rows still carrying the empty default `{}` facets. The column is
    // NOT NULL DEFAULT '{}', so containedBy(lhs={}) selects exactly those.
    .containedBy('facets', {})
    .order('starts_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(args.limit)

  if (args.source) {
    query = query.eq('source', args.source)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`Failed to fetch events needing facets: ${error.message}`)
  }
  return (data ?? []) as FacetRow[]
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const supabase = getSupabase()

  const events = await fetchEventsNeedingFacets(supabase, args)
  logger.info(`[backfill-facets] found ${events.length} events with empty facets`, {
    dryRun: !args.write,
    source: args.source ?? '*',
    limit: args.limit,
  })

  let updated = 0
  let failed = 0

  // DRY-RUN: print the candidate ids and exit without calling the LLM.
  if (!args.write) {
    if (events.length > 0) {
      console.log(`Dry-run — ${events.length} scheduled events have empty facets:`)
      for (const event of events) {
        console.log(`  ${event.id}\t${event.name}`)
      }
    } else {
      console.log('Dry-run — no scheduled events have empty facets.')
    }
    logger.info(`[backfill-facets] dry-run only; no facets extracted. Found ${events.length} candidates.`)
    return
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i]

    // Idempotency guard: skip anything that is no longer empty (e.g. a
    // concurrent enrich already filled it).
    if (!isEmptyFacets(event.facets)) {
      logger.debug(`[backfill-facets] skipping already-faceted ${event.id}`)
      continue
    }

    const facets: EventFacets = await extractEventFacets({
      name: event.name,
      description_es: event.description_es,
      description_en: event.description_en,
      categories: event.categories,
    })

    if (!isEmptyFacets(facets)) {
      const { error } = await supabase
        .from('events')
        .update({ facets })
        .eq('id', event.id)
      if (error) {
        failed++
        logger.error(`[backfill-facets] update failed for ${event.id}`, { error: error.message })
        continue
      }
      updated++
      logger.debug(`[backfill-facets] updated ${event.id}`, { facets })
    } else {
      logger.debug(`[backfill-facets] extraction returned empty for ${event.id}, not writing`)
    }

    if (i < events.length - 1) {
      await sleep(DELAY_MS)
    }
  }

  logger.info(
    `[backfill-facets] updated ${updated} events, ${failed} failed, ${events.length} total`
  )
}

main().catch((err) => {
  logger.error(`[backfill-facets] fatal: ${String(err)}`)
  process.exit(1)
})

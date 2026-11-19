#!/usr/bin/env node
/**
 * Dump the first 60 scheduled events on staging for refreshing the search golden set.
 *
 * Usage (Node 24): node evals/search/inspect-events.ts --staging
 */
import { searchEventsWithFilters } from '#shared/lib/db/client.server.ts'
import { openStagingCatalog } from '../lib/staging-catalog.ts'

export async function inspectEvents(target: string | undefined, connect?: Parameters<typeof openStagingCatalog>[1]) {
  await using staging = await openStagingCatalog(target, connect)
  return await searchEventsWithFilters({}, 60)
}

if (import.meta.main) {
  const events = await inspectEvents(process.argv[2])
  for (const e of events) {
    console.log(JSON.stringify({
      id: e.id,
      name: e.name,
      starts_at: e.starts_at,
      categories: e.categories,
      neighborhood: e.venue_neighborhood,
      venue: e.venue_name,
      is_free: e.is_free,
      price: e.price,
      summary: (e.description_summary_es ?? e.description_es ?? '').slice(0, 140),
    }))
  }
  console.error(`total: ${events.length}`)
}

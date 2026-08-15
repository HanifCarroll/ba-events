#!/usr/bin/env bun
/**
 * Dump upcoming scheduled events for building/refreshing the search golden set.
 * Events expire, so golden.ts needs periodic re-labeling against current data.
 *
 * Usage: bun evals/search/inspect-events.ts
 */
import { searchEventsWithFilters } from '#shared/lib/db/client.server.ts'

const events = await searchEventsWithFilters({} as never, 60)

for (const e of events) {
  console.log(
    JSON.stringify({
      id: e.id,
      name: e.name,
      starts_at: e.starts_at,
      categories: e.categories,
      neighborhood: e.venue_neighborhood,
      venue: e.venue_name,
      is_free: e.is_free,
      price: e.price,
      summary: (e.description_summary_es ?? e.description_es ?? '').slice(0, 140),
    })
  )
}
console.error(`total: ${events.length}`)

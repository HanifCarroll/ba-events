/**
 * Recategorize Existing Events
 *
 * This script recategorizes all existing events using the AI categorizer and
 * regenerates their search documents + embeddings with the canonical builder.
 *
 * Run with: bun scripts/recategorize-events.ts [--limit N]
 *
 * Requires SUPABASE_URL + SUPABASE_ANON_KEY (+ OPENAI_API_KEY for the
 * embedding model). Pass `--limit N` for a smoke run before the full backfill.
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { NO_THINKING, textModel } from '../src/shared/lib/ai/providers'
import { getSupabase } from '../src/shared/lib/db/client'
import { getSupabaseServiceRoleClient } from '../src/shared/lib/db/service'
import {
  embedEventWithDocument,
  CURRENT_EMBEDDING_VERSION,
} from '../src/shared/lib/ai/embeddings'

// The 6 simplified categories
const CATEGORY_SCHEMA = z.object({
  category: z.enum(['music', 'arts', 'food', 'social', 'sports', 'festival']),
})

const CATEGORIZATION_PROMPT = `Categorize this event into ONE of these categories:
- music: concerts, DJ sets, live performances, music festivals
- arts: theater, comedy, film, exhibitions, galleries, workshops, cultural events
- food: food markets, wine tastings, culinary events, restaurant events
- social: networking, meetups, parties, social gatherings, expat events
- sports: fitness, yoga, running, sports competitions, outdoor activities
- festival: multi-day festivals, large celebrations, fairs, carnivals

Based on the event name and description, choose the SINGLE most appropriate category.
If unclear, use "social" as the default.

Respond with ONLY a JSON object with a single "category" field, e.g. {"category": "music"}. Nothing else.`

async function categorizeEvent(
  name: string,
  description: string | null
): Promise<z.infer<typeof CATEGORY_SCHEMA>['category']> {
  try {
    const eventContext = `Event: ${name}${description ? `\nDescription: ${description}` : ''}`

    const { object } = await generateObject({
      model: textModel,
      schema: CATEGORY_SCHEMA,
      prompt: `${CATEGORIZATION_PROMPT}\n\n${eventContext}`,
      ...NO_THINKING,
    })

    return object.category
  } catch (error) {
    console.error('Error categorizing event:', error)
    return 'social'
  }
}

interface VenueInfo {
  name: string | null
  neighborhood: string | null
}

async function fetchVenueInfo(
  rows: Array<{ venue_id: string | null }>
): Promise<Map<string, VenueInfo>> {
  const venueIds = [...new Set(rows.map((r) => r.venue_id).filter((v): v is string => !!v))]
  if (venueIds.length === 0) return new Map()

  const { data, error } = await getSupabase()
    .from('venues')
    .select('id, name, neighborhood')
    .in('id', venueIds)

  if (error) throw new Error(`Failed to fetch venue info: ${error.message}`)
  return new Map((data ?? []).map((v) => [v.id, { name: v.name, neighborhood: v.neighborhood }]))
}

async function main() {
  const limitArg = process.argv.indexOf('--limit')
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Number.POSITIVE_INFINITY

  console.log('='.repeat(60))
  console.log('RECATEGORIZE EXISTING EVENTS')
  console.log('='.repeat(60))
  console.log()

  console.log('Fetching all events...')
  let query = getSupabase()
    .from('events')
    .select(
      'id, name, description_es, description_en, categories, facets, price, is_free, venue_id'
    )
    .order('created_at', { ascending: false })

  if (Number.isFinite(limit)) {
    query = query.limit(limit)
  }

  const { data: events, error } = await query

  if (error) {
    console.error('Failed to fetch events:', error)
    process.exit(1)
  }

  console.log(`Found ${events.length} events to process\n`)

  const venueInfo = await fetchVenueInfo(events as Array<{ venue_id: string | null }>)

  let processed = 0
  let updated = 0
  let failed = 0
  const BATCH_SIZE = 10

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    processed++

    try {
      // Categorize event
      const category = await categorizeEvent(event.name, event.description_es)

      const venue = event.venue_id ? venueInfo.get(event.venue_id) : undefined
      // Embed the NEW category (not the stale event.categories) so the search
      // document reflects what gets written, keeping vector and row in sync.
      const { embedding, searchDocument } = await embedEventWithDocument({
        name: event.name,
        description_es: event.description_es,
        description_en: event.description_en ?? undefined,
        categories: [category],
        facets: event.facets,
        price: event.price,
        is_free: event.is_free,
        venue_name: venue?.name ?? null,
        venue_neighborhood: venue?.neighborhood ?? null,
      })

      // Write category + embedding + search_document + version in one UPDATE so
      // the document and version can never drift out of sync with the vector.
      // The anon role has no RLS UPDATE on `events`, so writes must go through
      // the service-role client (same as scripts/reembed-stale.ts), otherwise
      // they are silently dropped.
      const { error: updateError } = await getSupabaseServiceRoleClient()
        .from('events')
        .update({
          categories: [category],
          embedding,
          search_document: searchDocument,
          embedding_version: CURRENT_EMBEDDING_VERSION,
        })
        .eq('id', event.id)

      if (updateError) {
        console.error(`Failed to update event ${event.id}:`, updateError)
        failed++
      } else {
        updated++
        console.log(`[${processed}/${events.length}] ${event.name.substring(0, 50)}... -> ${category}`)
      }
    } catch (err) {
      console.error(`Error processing event ${event.id}:`, err)
      failed++
    }

    // Rate limit protection - small delay between requests
    if (i > 0 && i % BATCH_SIZE === 0) {
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  console.log()
  console.log('='.repeat(60))
  console.log('COMPLETE')
  console.log('='.repeat(60))
  console.log(`Processed: ${processed}`)
  console.log(`Updated:   ${updated}`)
  console.log(`Failed:    ${failed}`)
}

main().catch(console.error)

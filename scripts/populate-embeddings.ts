#!/usr/bin/env bun
/**
 * Script to populate embeddings for all events that don't have them yet.
 * Run with: bun run scripts/populate-embeddings.ts
 */

import { createClient } from '@supabase/supabase-js'
import { embed } from 'ai'
import { embeddingModel } from '#shared/lib/ai/providers.ts'
import { buildEmbeddingText, CURRENT_EMBEDDING_VERSION } from '#shared/lib/ai/embeddings.ts'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

interface EventWithVenue {
  id: string
  name: string
  description_es: string | null
  categories: string[] | null
  is_free: boolean
  price: number | null
  venue_name: string | null
  venue_neighborhood: string | null
}

// buildEmbeddingText is imported from src/shared/lib/ai/embeddings (the
// canonical builder) — never fork it here.

async function generateEmbedding(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: embeddingModel,
    value: text,
  })
  return embedding
}

async function main() {
  console.log('Fetching events without embeddings...')

  const { data: events, error } = await supabase
    .from('events_with_venues')
    .select('*')
    .is('embedding', null)

  if (error) {
    console.error('Error fetching events:', error)
    process.exit(1)
  }

  if (!events || events.length === 0) {
    console.log('No events need embeddings. All done!')
    return
  }

  console.log(`Found ${events.length} events to process.`)

  let success = 0
  let failed = 0
  const BATCH_SIZE = 10

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE)
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(events.length / BATCH_SIZE)}...`)

    await Promise.all(
      batch.map(async (event: EventWithVenue) => {
        try {
          const text = buildEmbeddingText(event)
          console.log(`  Generating embedding for: ${event.name}`)
          console.log(`  Text: ${text.substring(0, 100)}...`)

          const embedding = await generateEmbedding(text)

          const { error: updateError } = await supabase
            .from('events')
            .update({
              embedding,
              search_document: text,
              embedding_version: CURRENT_EMBEDDING_VERSION,
            })
            .eq('id', event.id)

          if (updateError) throw updateError
          success++
          console.log(`  ✓ Done`)
        } catch (err) {
          failed++
          console.error(`  ✗ Failed: ${(err as Error).message}`)
        }
      })
    )

    // Rate limit protection
    if (i + BATCH_SIZE < events.length) {
      console.log('  Waiting 1 second for rate limit...')
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  console.log(`\n=== Complete ===`)
  console.log(`Success: ${success}`)
  console.log(`Failed: ${failed}`)
}

main()

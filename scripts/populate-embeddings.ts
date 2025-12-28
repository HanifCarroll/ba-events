#!/usr/bin/env bun
/**
 * Script to populate embeddings for all events that don't have them yet.
 * Run with: bun run scripts/populate-embeddings.ts
 */

import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_ANON_KEY
const openaiKey = process.env.OPENAI_API_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY')
  process.exit(1)
}

if (!openaiKey) {
  console.error('Missing OPENAI_API_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const openai = new OpenAI({ apiKey: openaiKey })

interface EventWithVenue {
  id: string
  name: string
  description: string | null
  categories: string[]
  vibes: string[]
  is_free: boolean
  price: number | null
  venue_name: string | null
  venue_neighborhood: string | null
  venue_type: string | null
}

function buildEmbeddingText(event: EventWithVenue): string {
  const parts: string[] = []

  parts.push(event.name)
  if (event.description) {
    parts.push(event.description)
  }

  if (event.categories && event.categories.length > 0) {
    parts.push(`Categories: ${event.categories.join(', ')}`)
  }

  if (event.vibes && event.vibes.length > 0) {
    parts.push(`Vibes: ${event.vibes.join(', ')}`)
  }

  if (event.venue_name) {
    const venueParts = [event.venue_name]
    if (event.venue_neighborhood) {
      venueParts.push(`in ${event.venue_neighborhood}`)
    }
    parts.push(`Venue: ${venueParts.join(' ')}`)

    if (event.venue_type && event.venue_type !== 'other') {
      parts.push(`Venue type: ${event.venue_type}`)
    }
  }

  if (event.is_free) {
    parts.push('This is a free event')
  } else if (event.price) {
    parts.push(`Price: ${event.price} ARS`)
  }

  return parts.join('. ')
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: 1536,
  })
  return response.data[0].embedding
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
            .update({ embedding })
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

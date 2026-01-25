/**
 * Fix Description Prefix Issue
 *
 * Finds events with "Semantic description for indexing:" prefix in their
 * descriptions, removes it, and regenerates embeddings.
 *
 * Run with: bun scripts/fix-description-prefix.ts
 */

import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

// Initialize clients
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!
)

const openai = new OpenAI()

// The prefix patterns to remove
const PREFIX_PATTERNS = [
  /^Semantic description for indexing:\s*/i,
  /^Semantic description:\s*/i,
  /^Description for indexing:\s*/i,
  /^Descripción semántica para indexación:\s*/i,
  /^Descripción semántica:\s*/i,
]

// Embedding configuration (matching src/shared/lib/ai/constants.ts)
const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536

function cleanDescription(description: string): string {
  let cleaned = description
  for (const pattern of PREFIX_PATTERNS) {
    cleaned = cleaned.replace(pattern, '')
  }
  return cleaned.trim()
}

function buildEmbeddingText(event: {
  name: string
  description_es: string | null
  categories: string[] | null
}): string {
  const parts: string[] = [event.name]

  if (event.description_es) {
    parts.push(event.description_es)
  }

  if (event.categories && event.categories.length > 0) {
    parts.push(`Categories: ${event.categories.join(', ')}`)
  }

  return parts.join('. ')
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  })
  return response.data[0].embedding
}

async function main() {
  console.log('🔍 Finding events with description prefix issues...\n')

  // Find events with the prefix in either description field
  const { data: events, error } = await supabase
    .from('events')
    .select('id, name, description_es, description_en, categories')
    .or('description_es.ilike.%Semantic description%,description_en.ilike.%Semantic description%')

  if (error) {
    console.error('❌ Error fetching events:', error)
    process.exit(1)
  }

  if (!events || events.length === 0) {
    console.log('✅ No events found with prefix issues!')
    return
  }

  console.log(`📋 Found ${events.length} event(s) with prefix issues:\n`)

  for (const event of events) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`📌 ${event.name}`)
    console.log(`   ID: ${event.id}`)

    let needsUpdate = false
    const updates: { description_es?: string; description_en?: string; embedding?: number[] } = {}

    // Check and clean Spanish description
    if (event.description_es) {
      const cleanedEs = cleanDescription(event.description_es)
      if (cleanedEs !== event.description_es) {
        console.log(`\n   🇪🇸 Spanish description (before):`)
        console.log(`      "${event.description_es.substring(0, 100)}..."`)
        console.log(`   🇪🇸 Spanish description (after):`)
        console.log(`      "${cleanedEs.substring(0, 100)}..."`)
        updates.description_es = cleanedEs
        needsUpdate = true
      }
    }

    // Check and clean English description
    if (event.description_en) {
      const cleanedEn = cleanDescription(event.description_en)
      if (cleanedEn !== event.description_en) {
        console.log(`\n   🇬🇧 English description (before):`)
        console.log(`      "${event.description_en.substring(0, 100)}..."`)
        console.log(`   🇬🇧 English description (after):`)
        console.log(`      "${cleanedEn.substring(0, 100)}..."`)
        updates.description_en = cleanedEn
        needsUpdate = true
      }
    }

    if (!needsUpdate) {
      console.log(`   ⏭️  No prefix found (false positive from search), skipping`)
      continue
    }

    // Regenerate embedding with cleaned Spanish description
    console.log(`\n   🔄 Regenerating embedding...`)
    const embeddingText = buildEmbeddingText({
      name: event.name,
      description_es: updates.description_es || event.description_es,
      categories: event.categories,
    })
    updates.embedding = await generateEmbedding(embeddingText)
    console.log(`   ✅ Embedding regenerated (${updates.embedding.length} dimensions)`)

    // Update the event
    const { error: updateError } = await supabase
      .from('events')
      .update(updates)
      .eq('id', event.id)

    if (updateError) {
      console.error(`   ❌ Error updating event:`, updateError)
    } else {
      console.log(`   ✅ Event updated successfully!`)
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`\n✅ Done! Processed ${events.length} event(s).`)
}

main().catch(console.error)

// scripts/detect-address-venues.ts
import { createClient } from '@supabase/supabase-js'
import { generateObject } from 'ai'
import { z } from 'zod'
import { NO_THINKING, textModel } from '#shared/lib/ai/providers.ts'

// .env is auto-loaded by Bun (dotenv removed: not a dependency in this repo; see migration evidence T1)

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const ADDRESS_SCHEMA = z.object({
  results: z.array(
    z.object({
      index: z.number(),
      is_address: z.boolean(),
      confidence: z.number(),
    })
  ),
})

async function main() {
  // Get pending venues
  const { data: venues, error } = await supabase
    .from('venues')
    .select('id, name')
    .eq('address_check_status', 'pending')
    .order('created_at', { ascending: false })

  if (error) throw error
  if (!venues?.length) {
    console.log('No pending venues to analyze')
    return
  }

  console.log(`Analyzing ${venues.length} pending venues...`)

  // Process in batches of 20
  const BATCH_SIZE = 20
  const results: Array<{ id: string; is_address: boolean; confidence: number }> = []

  for (let i = 0; i < venues.length; i += BATCH_SIZE) {
    const batch = venues.slice(i, i + BATCH_SIZE)
    const venueList = batch.map((v, idx) => `${idx + 1}. "${v.name}"`).join('\n')

    console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(venues.length / BATCH_SIZE)}`)

    try {
      const { object } = await generateObject({
        model: textModel,
        schema: ADDRESS_SCHEMA,
        prompt: `Analyze these venue names from Buenos Aires and identify which ones look like street addresses rather than proper venue/business names.

Address-like patterns include:
- Street names with numbers (e.g., "Av. Corrientes 1234", "Thames 2100")
- Just a street name (e.g., "Calle Florida", "Avenida de Mayo")
- Intersection descriptions (e.g., "Corrientes y Callao")
- Building or floor descriptions (e.g., "Piso 5, Oficina 12")

Proper venue names include:
- Business names (e.g., "La Biblioteca Cafe", "Bebop Club", "Teatro Colon")
- Cultural venues (e.g., "Centro Cultural Recoleta", "Museo de Arte Moderno")
- Generic descriptive names are OK (e.g., "Multiespacio para Eventos")

For each venue in the list, report:
- "index": the number from the list (1-based)
- "is_address": true if it looks like an address, false if it's a proper venue name
- "confidence": 0.0 to 1.0

Venues to analyze:
${venueList}`,
        ...NO_THINKING,
      })

      for (const r of object.results) {
        const venue = batch[r.index - 1]
        if (venue) {
          results.push({ id: venue.id, is_address: r.is_address, confidence: r.confidence })
          if (r.is_address && r.confidence > 0.7) {
            console.log(`  ⚠️  ${venue.name} (${Math.round(r.confidence * 100)}%)`)
          }
        }
      }
    } catch (e) {
      console.error('Failed to analyze batch:', e)
      // Mark as not_flagged on failure
      for (const v of batch) {
        results.push({ id: v.id, is_address: false, confidence: 0 })
      }
    }

    // Rate limit
    if (i + BATCH_SIZE < venues.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  // Update database
  const flagged = results.filter(r => r.is_address && r.confidence > 0.7)
  const notFlagged = results.filter(r => !r.is_address || r.confidence <= 0.7)

  if (flagged.length > 0) {
    await supabase
      .from('venues')
      .update({ address_check_status: 'flagged' })
      .in('id', flagged.map(r => r.id))
  }

  if (notFlagged.length > 0) {
    await supabase
      .from('venues')
      .update({ address_check_status: 'not_flagged' })
      .in('id', notFlagged.map(r => r.id))
  }

  console.log(`\nResults:`)
  console.log(`  Flagged as address-like: ${flagged.length}`)
  console.log(`  Confirmed as venue names: ${notFlagged.length}`)
}

main().catch(console.error)

// scripts/audit-all-venues.ts
// One-time audit: run AI analysis on ALL venues to check for address-like names
// Does NOT update the database - just outputs results for review

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { generateObject } from 'ai'
import { z } from 'zod'
import { NO_THINKING, textModel } from '../src/shared/lib/ai/providers'

config({ path: '.env' })

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
  // Get ALL venues
  const { data: venues, error } = await supabase
    .from('venues')
    .select('id, name, address_check_status')
    .order('name')

  if (error) throw error
  if (!venues?.length) {
    console.log('No venues found')
    return
  }

  console.log(`Analyzing ${venues.length} total venues...\n`)

  // Process in batches of 30
  const BATCH_SIZE = 30
  const results: Array<{ id: string; name: string; current_status: string; is_address: boolean; confidence: number }> = []

  for (let i = 0; i < venues.length; i += BATCH_SIZE) {
    const batch = venues.slice(i, i + BATCH_SIZE)
    const venueList = batch.map((v, idx) => `${idx + 1}. "${v.name}"`).join('\n')

    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(venues.length / BATCH_SIZE)}...`)

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
- Generic location descriptions (e.g., "Punto de Encuentro", "edificio antiguo")

Proper venue names include:
- Business names (e.g., "La Biblioteca Cafe", "Bebop Club", "Teatro Colon")
- Cultural venues (e.g., "Centro Cultural Recoleta", "Museo de Arte Moderno")
- Parks and landmarks (e.g., "Parque Las Heras", "Obelisco")
- Named plazas (e.g., "Plaza de Mayo", "Plaza Italia")

For each venue in the list, report:
- "index": the number from the list (1-based)
- "is_address": true if it looks like an address/generic location, false if it's a proper venue name
- "confidence": 0.0 to 1.0

Venues to analyze:
${venueList}`,
        ...NO_THINKING,
      })

      for (const r of object.results) {
        const venue = batch[r.index - 1]
        if (venue) {
          results.push({
            id: venue.id,
            name: venue.name,
            current_status: venue.address_check_status,
            is_address: r.is_address,
            confidence: r.confidence
          })
        }
      }
    } catch (e) {
      console.error('Failed to analyze batch, skipping...', e)
      for (const v of batch) {
        results.push({
          id: v.id,
          name: v.name,
          current_status: v.address_check_status,
          is_address: false,
          confidence: 0
        })
      }
    }

    // Rate limit
    if (i + BATCH_SIZE < venues.length) {
      await new Promise(r => setTimeout(r, 300))
    }
  }

  // Categorize results
  const flaggedAsAddress = results.filter(r => r.is_address && r.confidence > 0.7)
  const maybeFlagged = results.filter(r => r.is_address && r.confidence > 0.5 && r.confidence <= 0.7)
  const confirmedVenues = results.filter(r => !r.is_address || r.confidence <= 0.5)

  console.log('\n' + '='.repeat(60))
  console.log('AUDIT RESULTS')
  console.log('='.repeat(60))

  console.log(`\n## FLAGGED AS ADDRESS-LIKE (${flaggedAsAddress.length}) - confidence > 70%:\n`)
  for (const r of flaggedAsAddress.sort((a, b) => b.confidence - a.confidence)) {
    const statusEmoji = r.current_status === 'not_flagged' ? '⚠️' :
                        r.current_status === 'confirmed_venue' ? '🔴' : '🟡'
    console.log(`${statusEmoji} [${r.current_status}] ${r.name} (${Math.round(r.confidence * 100)}%)`)
  }

  console.log(`\n## MAYBE ADDRESS (${maybeFlagged.length}) - confidence 50-70%:\n`)
  for (const r of maybeFlagged.sort((a, b) => b.confidence - a.confidence)) {
    console.log(`🟠 [${r.current_status}] ${r.name} (${Math.round(r.confidence * 100)}%)`)
  }

  console.log(`\n## CONFIRMED AS REAL VENUES (${confirmedVenues.length})`)
  console.log('(not printed - too many)')

  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`Total venues: ${results.length}`)
  console.log(`Flagged as address (>70%): ${flaggedAsAddress.length}`)
  console.log(`Maybe address (50-70%): ${maybeFlagged.length}`)
  console.log(`Confirmed venues (<50%): ${confirmedVenues.length}`)

  // Check for mismatches
  const wronglyMarkedSafe = flaggedAsAddress.filter(r => r.current_status === 'not_flagged' || r.current_status === 'confirmed_venue')
  if (wronglyMarkedSafe.length > 0) {
    console.log(`\n⚠️  ${wronglyMarkedSafe.length} venues are marked safe but look like addresses!`)
  }
}

main().catch(console.error)

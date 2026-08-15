import { createClient } from '@supabase/supabase-js'

// .env is auto-loaded by Bun (dotenv removed: not a dependency in this repo; see migration evidence T1)

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Addresses found via Google Maps search - Batch 5
const addressUpdates = [
  { name: 'FATS CAFÉ', address: 'Nicasio Oroño 1269' },
  { name: 'Base Cultural Ugarte', address: 'Manuel Ugarte 2789' },
  { name: 'Auditorio Espacio Cendas', address: 'Bulnes 1350' },
  { name: 'Studio Crobar', address: 'Av. Coronel Marcelino E. Freyre' },
  { name: 'MALACARARESTOBAR', address: 'Marcelo Torcuato de Alvear 1500' },
]

async function main() {
  console.log('Updating venue addresses (Batch 5)...\n')

  let updated = 0
  let notFound = 0

  for (const update of addressUpdates) {
    const { data: venues, error } = await supabase
      .from('venues')
      .select('id, name, address')
      .ilike('name', `%${update.name}%`)

    if (error) {
      console.error(`Error finding ${update.name}:`, error.message)
      continue
    }

    if (!venues || venues.length === 0) {
      console.log(`✗ Not found: ${update.name}`)
      notFound++
      continue
    }

    for (const venue of venues) {
      if (venue.address) {
        console.log(`⊘ Already has address: ${venue.name} (${venue.address})`)
        continue
      }

      const { error: updateError } = await supabase
        .from('venues')
        .update({ address: update.address })
        .eq('id', venue.id)

      if (updateError) {
        console.error(`Error updating ${venue.name}:`, updateError.message)
      } else {
        console.log(`✓ Updated: ${venue.name} → ${update.address}`)
        updated++
      }
    }
  }

  console.log(`\n=== SUMMARY ===`)
  console.log(`Updated: ${updated}`)
  console.log(`Not found: ${notFound}`)

  process.exit(0)
}

main()

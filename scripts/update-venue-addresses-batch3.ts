import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env' })

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Addresses found via Google Maps search - Batch 3
const addressUpdates = [
  { name: 'Palacete', address: 'Av. Alvear 1637' },
  { name: 'ALBUR', address: 'Av. Callao 435' },
  { name: 'Sturla', address: 'Mendoza 1900' },
  { name: 'Moscú Espacio Cultural', address: 'Valentín Ortiz 343' },
  { name: 'Club CasaBlanca', address: 'Juan A. García 332' },
  { name: 'The Sub Club', address: 'Av. Córdoba 543' },
  { name: 'LIGNEE', address: 'Lavalle 945' },
]

async function main() {
  console.log('Updating venue addresses (Batch 3)...\n')

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

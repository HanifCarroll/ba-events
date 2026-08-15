import { createClient } from '@supabase/supabase-js'

// .env is auto-loaded by Bun (dotenv removed: not a dependency in this repo; see migration evidence T1)

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Addresses found via Google Maps search
const addressUpdates = [
  { name: 'INK Palermo', address: 'Cnel. Niceto Vega 5635' },
  { name: 'Lucille', address: 'Gorriti 5520' },
  { name: 'Club Cultural Matienzo', address: 'Av. Juan B. Justo 2959' }, // Not in our list but good to have
  { name: 'Hawaiian Love', address: 'Av. Juan B. Justo 8420' },
  { name: 'Palermo Groove', address: 'Av. Santa Fe 4389' },
  { name: 'Bosque', address: 'Av. del Libertador 3883' },
  { name: 'NAN BAR', address: 'Gorriti 4647' },
  { name: 'JAZZ VOYEUR CLUB - Hotel Melia Recoleta Plaza', address: 'Posadas 1557' },
]

async function main() {
  console.log('Updating venue addresses...\n')

  let updated = 0
  let notFound = 0

  for (const update of addressUpdates) {
    // Find venue by name (case-insensitive partial match)
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

    // Update each matching venue
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

import { createClient } from '@supabase/supabase-js'

// .env is auto-loaded by Bun (dotenv removed: not a dependency in this repo; see migration evidence T1)

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Addresses found via Google Maps search - Batch 2
const addressUpdates = [
  { name: 'BLOW', address: 'Niceto Vega 5699' },
  { name: 'Requiem Club', address: 'Av. de Mayo 948' },
  { name: 'CCQI', address: 'Thames 240' },
  { name: 'Fundación Rio Abierto', address: 'Paraguay 4694' },
  { name: 'Cultural Morán', address: 'Pedro Morán 2147' },
  { name: 'La Recova de Posadas', address: 'Posadas 1067' },
  { name: 'CLUB SOCIAL CAMBALACHE', address: 'Defensa 1179' },
  { name: 'Mantra Club', address: 'Nicaragua 4000' },
  { name: 'BOX KARAOKE BAR', address: 'Salguero 1135' },
  { name: 'BLACK BELGRANO', address: 'Juramento 1543' },
]

async function main() {
  console.log('Updating venue addresses (Batch 2)...\n')

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

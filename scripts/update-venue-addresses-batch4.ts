import { createClient } from '@supabase/supabase-js'

// .env is auto-loaded by Bun (dotenv removed: not a dependency in this repo; see migration evidence T1)

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Addresses found via Google Maps search - Batch 4
const addressUpdates = [
  { name: 'MANIFIESTO NUÑEZ', address: 'Arribeños 3520' },
  { name: 'Mundo GEA', address: 'Av. Gral. Las Heras 4159' },
  { name: 'Wax Club Cultural', address: 'Maipú 878' },
  { name: 'Campo Argentino de Polo', address: 'Av. del Libertador 4096' },
  { name: 'Obelisco de Buenos Aires', address: 'Av. Corrientes y 9 de Julio' },
  { name: 'Tramway Histórico', address: 'Emilio Mitre 500' },
  { name: 'Bus Turístico', address: 'Av. Pres. Roque Sáenz Peña 846' },
]

async function main() {
  console.log('Updating venue addresses (Batch 4)...\n')

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

import { createClient } from '@supabase/supabase-js'

// .env is auto-loaded by Bun (dotenv removed: not a dependency in this repo; see migration evidence T1)

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Venue updates from Google Maps research - Feb 2, 2026
// These are new venues from the Passline import
const venueUpdates = [
  {
    id: '9b71b471-072c-4429-9ef0-77e77379084c',
    name: 'KIKA CLUB',
    address: 'Honduras 5339',
    neighborhood: 'Palermo',
  },
  {
    id: '1406181d-c9c8-4168-8cef-25335b8bd19b',
    name: 'Complejo Belgrano',
    address: 'Av. Belgrano 2608',
    neighborhood: 'Balvanera',
  },
  {
    id: 'c18515b3-33a5-443b-8c4d-1e376e52d3a8',
    name: 'Casa Cultural Tita Merello',
    address: 'Inclán 4191',
    neighborhood: 'Boedo',
  },
  {
    id: '0506a1ab-db9d-44bb-b598-b0edd350a5cb',
    name: 'Museo Marco',
    address: 'Av. Almte. Brown 1031',
    neighborhood: 'La Boca',
  },
  {
    id: 'ef694322-291a-407e-b2c4-7642180b66fd',
    name: 'La Biblioteca Café (new)',
    address: 'Marcelo T. de Alvear 1155',
    neighborhood: 'Retiro',
  },
  {
    id: 'f7f0680f-f5ff-4e27-bc1d-543fd795e9ff',
    name: 'La Biblioteca Café (existing - fix neighborhood)',
    address: null, // Don't update address, already has it
    neighborhood: 'Retiro', // Fix: was incorrectly San Telmo
  },
  {
    id: 'ee4a7324-ab2f-40ad-8aff-ee1cf00d4567',
    name: 'Cooperativa Cultural QI',
    address: 'Thames 240',
    neighborhood: 'Villa Crespo',
  },
  {
    id: 'ca4ba3b0-5062-49ca-bd68-b25cf5ddedef',
    name: 'LOLITA PALERMO',
    address: 'Cnel. Niceto Vega 5642',
    neighborhood: 'Palermo',
  },
  {
    id: 'ceea9f84-e287-4706-a1f1-bd5487fd0703',
    name: 'Crepas Palermo',
    address: 'Gurruchaga 1791',
    neighborhood: 'Palermo', // Already has this, but including for completeness
  },
  {
    id: 'ddfb8eed-540d-4152-824b-17142293a038',
    name: 'Honduras (Honduras Hollywood)',
    address: 'Honduras 5535',
    neighborhood: 'Palermo', // Already has this, but including for completeness
  },
]

async function main() {
  console.log('=== Updating Passline venue addresses and neighborhoods ===\n')

  let updated = 0
  let failed = 0

  for (const venue of venueUpdates) {
    const updateData: { address?: string; neighborhood?: string } = {}

    if (venue.address) {
      updateData.address = venue.address
    }
    if (venue.neighborhood) {
      updateData.neighborhood = venue.neighborhood
    }

    const { error } = await supabase
      .from('venues')
      .update(updateData)
      .eq('id', venue.id)

    if (error) {
      console.error(`✗ Failed to update ${venue.name}:`, error.message)
      failed++
    } else {
      console.log(`✓ Updated: ${venue.name}`)
      if (venue.address) console.log(`  Address: ${venue.address}`)
      console.log(`  Neighborhood: ${venue.neighborhood}\n`)
      updated++
    }
  }

  console.log('\n=== SUMMARY ===')
  console.log(`Updated: ${updated}`)
  console.log(`Failed: ${failed}`)

  process.exit(0)
}

main()

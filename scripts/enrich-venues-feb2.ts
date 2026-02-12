import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env' })

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Venue updates from Google Maps research - Feb 2, 2026
const venueUpdates = [
  {
    id: '9818a95b-219c-471a-9679-c5df90b71fc4',
    name: 'CIA, Ciudad Autónoma de Buenos Aires',
    address: 'Tucumán 3758',
    neighborhood: 'Almagro', // Was incorrectly Villa Soldati
  },
  {
    id: '352917fa-8b2d-41cd-b34b-03c567f8eb54',
    name: 'GUCHITO Taller de sanguches',
    address: 'Av. Jorge Newbery 3824',
    neighborhood: 'Chacarita',
  },
  {
    id: '723a2c97-7b6e-4886-ac4c-26c564efdad4',
    name: 'Eleo Zanoni Pasteleria',
    address: 'Amenábar 30',
    neighborhood: 'Colegiales',
  },
  {
    id: '90a9c501-1c1c-48f6-b767-9aefd1be6d70',
    name: 'José A. Cabrera 4427',
    address: 'José A. Cabrera 4427',
    neighborhood: 'Palermo',
  },
  {
    id: '4b5e4da1-45c1-43f3-a395-782bd9ca55d2',
    name: 'La Casa de Luca',
    address: 'Adolfo Alsina 451',
    neighborhood: 'Monserrat',
  },
  {
    id: '7c77c6b2-6a60-40ce-a637-efc9eb304619',
    name: 'Av. Córdoba 2988',
    address: 'Av. Córdoba 2988',
    neighborhood: 'Balvanera',
  },
  {
    id: '459bf718-d712-436d-a140-5e82450afa21',
    name: 'Malecon Puerto Madero',
    address: 'Cecilia Grierson 400',
    neighborhood: 'Puerto Madero',
  },
]

// Venues that cannot be enriched
const cannotEnrich = [
  {
    id: '210b823a-cb4c-4c0c-9df9-f3abfbded78e',
    name: 'Buenos Aires, Ciudad Autónoma de Buenos Aires',
    reason: 'Too generic - city name, not a specific venue',
  },
  {
    id: '2c9f215b-047d-4544-b5cb-bf1b22c57307',
    name: 'Secret Location',
    reason: 'Intentionally vague - event does not disclose venue',
  },
  {
    id: '95866b1d-2519-4096-bc9f-0c57e1d3ecbe',
    name: 'AAC, Ciudad Autónoma de Buenos Aires',
    reason: 'Ambiguous - multiple organizations match AAC acronym',
  },
]

async function main() {
  console.log('=== Updating venue addresses and neighborhoods ===\n')

  let updated = 0
  let failed = 0

  for (const venue of venueUpdates) {
    const { error } = await supabase
      .from('venues')
      .update({
        address: venue.address,
        neighborhood: venue.neighborhood,
      })
      .eq('id', venue.id)

    if (error) {
      console.error(`✗ Failed to update ${venue.name}:`, error.message)
      failed++
    } else {
      console.log(`✓ Updated: ${venue.name}`)
      console.log(`  Address: ${venue.address}`)
      console.log(`  Neighborhood: ${venue.neighborhood}\n`)
      updated++
    }
  }

  console.log('\n=== Marking venues as cannot_enrich ===\n')

  let markedCannotEnrich = 0

  for (const venue of cannotEnrich) {
    const { error } = await supabase
      .from('venues')
      .update({
        venue_enrichment_status: 'cannot_enrich',
      })
      .eq('id', venue.id)

    if (error) {
      console.error(`✗ Failed to mark ${venue.name}:`, error.message)
    } else {
      console.log(`⊘ Marked cannot_enrich: ${venue.name}`)
      console.log(`  Reason: ${venue.reason}\n`)
      markedCannotEnrich++
    }
  }

  console.log('\n=== SUMMARY ===')
  console.log(`Updated with address/neighborhood: ${updated}`)
  console.log(`Marked cannot_enrich: ${markedCannotEnrich}`)
  console.log(`Failed: ${failed}`)

  process.exit(0)
}

main()

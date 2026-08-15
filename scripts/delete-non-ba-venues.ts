import { createClient } from '@supabase/supabase-js'

// .env is auto-loaded by Bun (dotenv removed: not a dependency in this repo; see migration evidence T1)

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Known non-BA venue names/patterns
const NON_BA_PATTERNS = [
  'Colts Neck',
  'Buffalo Wing Factory',
  'Body Grace Fitness',
  'Buenos Aires, Ciudad Autónoma de Buenos Aires', // Generic placeholder, not a real venue
]

async function main() {
  const { data: allVenues, error } = await supabase
    .from('venues')
    .select('id, name, address, neighborhood')

  if (error) {
    console.error('Error:', error)
    process.exit(1)
  }

  // Find non-BA venues
  const toDelete = allVenues.filter(v =>
    NON_BA_PATTERNS.some(pattern =>
      v.name?.includes(pattern) || v.address?.includes(pattern)
    )
  )

  console.log(`Found ${toDelete.length} non-BA venues to delete:`)
  toDelete.forEach(v => console.log(`  - ${v.name} | ${v.address || 'no address'}`))

  if (toDelete.length === 0) {
    console.log('Nothing to delete.')
    process.exit(0)
  }

  const venueIds = toDelete.map(v => v.id)

  // Find associated events
  const { data: events } = await supabase
    .from('events')
    .select('id')
    .in('venue_id', venueIds)

  console.log(`\nFound ${events?.length || 0} associated events`)

  // Delete events first
  if (events && events.length > 0) {
    const { error: delEventsErr } = await supabase
      .from('events')
      .delete()
      .in('venue_id', venueIds)
    if (delEventsErr) {
      console.error('Error deleting events:', delEventsErr)
      process.exit(1)
    }
    console.log(`✓ Deleted ${events.length} events`)
  }

  // Delete venues
  const { error: delVenuesErr } = await supabase
    .from('venues')
    .delete()
    .in('id', venueIds)

  if (delVenuesErr) {
    console.error('Error deleting venues:', delVenuesErr)
    process.exit(1)
  }
  console.log(`✓ Deleted ${toDelete.length} venues`)

  process.exit(0)
}

main()

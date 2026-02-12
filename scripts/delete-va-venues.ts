import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env' })

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  // Find all Virginia venues by selecting all and filtering
  const { data: allVenues, error } = await supabase
    .from('venues')
    .select('id, name, address')

  if (error) {
    console.error('Error finding venues:', error)
    process.exit(1)
  }

  // Filter for Virginia venues
  const venues = allVenues.filter(v => 
    v.address && (
      v.address.includes('Reston, VA') ||
      v.address.includes('Sterling, VA') ||
      v.address.includes('McLean, VA') ||
      v.address.includes('Oakton, VA') ||
      v.address.includes('Reston, va')
    )
  )

  console.log(`Found ${venues.length} Virginia venues to delete:`)
  venues.forEach(v => console.log(`  - ${v.name} (${v.address})`))

  if (venues.length === 0) {
    console.log('No Virginia venues found.')
    process.exit(0)
  }

  const venueIds = venues.map(v => v.id)
  
  // Find events (use correct column name)
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, name')
    .in('venue_id', venueIds)

  if (eventsError) {
    console.error('Error finding events:', eventsError)
    process.exit(1)
  }

  console.log(`\nFound ${events.length} associated events to delete`)

  // Delete events
  if (events.length > 0) {
    const { error: deleteEventsError } = await supabase
      .from('events')
      .delete()
      .in('venue_id', venueIds)

    if (deleteEventsError) {
      console.error('Error deleting events:', deleteEventsError)
      process.exit(1)
    }
    console.log(`✓ Deleted ${events.length} events`)
  }

  // Delete venues
  const { error: deleteVenuesError } = await supabase
    .from('venues')
    .delete()
    .in('id', venueIds)

  if (deleteVenuesError) {
    console.error('Error deleting venues:', deleteVenuesError)
    process.exit(1)
  }
  console.log(`✓ Deleted ${venues.length} venues`)

  console.log('\nDone!')
  process.exit(0)
}

main()

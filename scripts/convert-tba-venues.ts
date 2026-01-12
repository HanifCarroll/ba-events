import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function main() {
  // Find TBA venues
  const tbaVenueNames = ['Venue TBA', 'Restaurant of the Week']

  for (const venueName of tbaVenueNames) {
    const { data: venue } = await supabase
      .from('venues')
      .select('id, name')
      .eq('name', venueName)
      .single()

    if (!venue) {
      console.log('Venue not found:', venueName)
      continue
    }

    console.log('Processing:', venueName, '(' + venue.id + ')')

    // Update events to set location_tba = true and venue_id = null
    const { data: events, error: updateError } = await supabase
      .from('events')
      .update({ location_tba: true, venue_id: null })
      .eq('venue_id', venue.id)
      .select('id, name')

    if (updateError) {
      console.error('Error updating events:', updateError.message)
      continue
    }

    console.log('  Updated', events?.length || 0, 'events to location_tba=true')
    events?.forEach(e => console.log('    -', e.name))

    // Delete the venue
    const { error: deleteError } = await supabase
      .from('venues')
      .delete()
      .eq('id', venue.id)

    if (deleteError) {
      console.error('Error deleting venue:', deleteError.message)
    } else {
      console.log('  Deleted venue:', venueName)
    }
  }

  // Verify no more venues without neighborhoods
  const { data: remaining } = await supabase
    .from('venues')
    .select('name')
    .is('neighborhood', null)

  console.log('\nRemaining venues without neighborhoods:', remaining?.length || 0)
  remaining?.forEach(v => console.log('  -', v.name))
}

main()

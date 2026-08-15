/**
 * Cleanup Script: Remove events outside Buenos Aires
 *
 * This script identifies and removes events that were incorrectly imported
 * from locations outside Buenos Aires (e.g., Virginia, USA).
 *
 * Run with: npx tsx scripts/cleanup-non-ba-events.ts
 *
 * Set DRY_RUN=false to actually delete events.
 */

import { createClient } from '@supabase/supabase-js'

// Load environment variables
// .env is auto-loaded by Bun (dotenv removed: not a dependency in this repo; see migration evidence T1)

const DRY_RUN = process.env.DRY_RUN !== 'false'

// Known non-BA location patterns
// Note: "florida" is excluded because it's a famous street/neighborhood in Buenos Aires!
const NON_BA_PATTERNS = [
  'virginia',
  'herndon',
  'fairfax',
  'washington dc',
  'maryland',
  'new york',
  'california',
  'texas',
  // 'florida' - EXCLUDED: Florida is a street in Buenos Aires!
  'chicago',
  'boston',
  'seattle',
  'san francisco',
  'los angeles',
  'fortnightly library',
]

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
    process.exit(1)
  }

  const client = createClient(supabaseUrl, supabaseServiceKey)

  console.log('='.repeat(60))
  console.log(DRY_RUN ? '🔍 DRY RUN MODE - No changes will be made' : '⚠️  LIVE MODE - Events will be deleted!')
  console.log('='.repeat(60))
  console.log()

  // Step 1: Find events with venues that have non-BA location patterns
  console.log('Step 1: Finding events with non-BA venue names/addresses...')

  const { data: venues, error: venueError } = await client
    .from('venues')
    .select('id, name, address, neighborhood')

  if (venueError) {
    console.error('Error fetching venues:', venueError)
    process.exit(1)
  }

  const nonBAVenueIds: string[] = []
  const nonBAVenues: Array<{ id: string; name: string; address: string | null }> = []

  for (const venue of venues || []) {
    const searchText = `${venue.name} ${venue.address || ''} ${venue.neighborhood || ''}`.toLowerCase()
    const matchedPattern = NON_BA_PATTERNS.find(pattern => searchText.includes(pattern))

    if (matchedPattern) {
      nonBAVenueIds.push(venue.id)
      nonBAVenues.push({ id: venue.id, name: venue.name, address: venue.address })
      console.log(`  ❌ Venue: "${venue.name}" (matched: "${matchedPattern}")`)
    }
  }

  console.log(`\nFound ${nonBAVenueIds.length} non-BA venues`)

  // Step 2: Find events linked to these venues
  if (nonBAVenueIds.length > 0) {
    const { data: eventsWithBadVenues, error: eventsError } = await client
      .from('events')
      .select('id, name, external_id, venue_id, link')
      .in('venue_id', nonBAVenueIds)

    if (eventsError) {
      console.error('Error fetching events:', eventsError)
      process.exit(1)
    }

    console.log(`\nFound ${eventsWithBadVenues?.length || 0} events linked to non-BA venues:`)
    for (const event of eventsWithBadVenues || []) {
      const venue = nonBAVenues.find(v => v.id === event.venue_id)
      console.log(`  - "${event.name}" at "${venue?.name}"`)
      if (event.link) {
        console.log(`    URL: ${event.link}`)
      }
    }

    // Delete events
    if (!DRY_RUN && eventsWithBadVenues && eventsWithBadVenues.length > 0) {
      const eventIds = eventsWithBadVenues.map(e => e.id)
      console.log(`\n🗑️  Deleting ${eventIds.length} events...`)

      const { error: deleteError } = await client
        .from('events')
        .delete()
        .in('id', eventIds)

      if (deleteError) {
        console.error('Error deleting events:', deleteError)
      } else {
        console.log('✅ Events deleted successfully')
      }
    }

    // Delete venues (after events are deleted)
    if (!DRY_RUN && nonBAVenueIds.length > 0) {
      console.log(`\n🗑️  Deleting ${nonBAVenueIds.length} non-BA venues...`)

      const { error: deleteVenueError } = await client
        .from('venues')
        .delete()
        .in('id', nonBAVenueIds)

      if (deleteVenueError) {
        console.error('Error deleting venues:', deleteVenueError)
      } else {
        console.log('✅ Venues deleted successfully')
      }
    }
  }

  // Step 3: Find events by source URL patterns (Meetup groups not in BA)
  console.log('\n' + '='.repeat(60))
  console.log('Step 2: Finding Meetup events from non-BA groups...')

  // Look for Meetup URLs that don't contain Buenos Aires related strings
  const { data: meetupEvents, error: meetupError } = await client
    .from('events')
    .select('id, name, link, external_id')
    .eq('source', 'meetup')
    .not('link', 'is', null)

  if (meetupError) {
    console.error('Error fetching Meetup events:', meetupError)
  } else {
    const suspiciousEvents: Array<{ id: string; name: string; link: string }> = []

    for (const event of meetupEvents || []) {
      if (!event.link) continue

      // Check if URL contains non-BA location indicators
      const urlLower = event.link.toLowerCase()
      const isSuspicious = NON_BA_PATTERNS.some(pattern =>
        urlLower.includes(pattern.replace(' ', '-'))
      )

      if (isSuspicious) {
        suspiciousEvents.push({
          id: event.id,
          name: event.name,
          link: event.link,
        })
      }
    }

    if (suspiciousEvents.length > 0) {
      console.log(`\nFound ${suspiciousEvents.length} suspicious Meetup events:`)
      for (const event of suspiciousEvents) {
        console.log(`  - "${event.name}"`)
        console.log(`    URL: ${event.link}`)
      }

      if (!DRY_RUN) {
        const eventIds = suspiciousEvents.map(e => e.id)
        console.log(`\n🗑️  Deleting ${eventIds.length} suspicious events...`)

        const { error: deleteError } = await client
          .from('events')
          .delete()
          .in('id', eventIds)

        if (deleteError) {
          console.error('Error deleting events:', deleteError)
        } else {
          console.log('✅ Events deleted successfully')
        }
      }
    } else {
      console.log('No suspicious Meetup events found by URL pattern')
    }
  }

  console.log('\n' + '='.repeat(60))
  if (DRY_RUN) {
    console.log('🔍 DRY RUN COMPLETE')
    console.log('To actually delete events, run with: DRY_RUN=false npx tsx scripts/cleanup-non-ba-events.ts')
  } else {
    console.log('✅ CLEANUP COMPLETE')
  }
}

main().catch(console.error)

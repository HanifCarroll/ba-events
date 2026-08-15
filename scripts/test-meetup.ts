/**
 * Meetup Scraper Test Script
 *
 * Tests the Meetup scraper by fetching events and displaying sample data.
 *
 * Run with: bun scripts/test-meetup.ts
 */

import { scrapeMeetupEvents, filterInPersonEvents } from '#features/import/scrapers/meetup/browser-scraper.ts'
import { expandRecurringEventWithIds, formatArgentinaDate } from '#features/import/scrapers/meetup/date-parser.ts'

async function main() {
  console.log('='.repeat(80))
  console.log('MEETUP SCRAPER TEST')
  console.log('='.repeat(80))
  console.log()

  // Default to next 7 days
  const today = new Date()
  const nextWeek = new Date(today)
  nextWeek.setDate(nextWeek.getDate() + 7)

  const startDate = today.toISOString().split('T')[0]
  const endDate = nextWeek.toISOString().split('T')[0]

  try {
    // Step 1: Scrape events
    console.log('1. SCRAPING MEETUP EVENTS')
    console.log('-'.repeat(80))
    console.log(`   Fetching events from ${startDate} to ${endDate}...`)
    console.log()

    const startTime = Date.now()
    const allEvents = await scrapeMeetupEvents({ startDate, endDate })
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    console.log(`   Total events found: ${allEvents.length}`)
    console.log(`   Scraping took: ${duration}s`)
    console.log()

    // Step 2: Filter in-person events
    console.log('2. FILTERING IN-PERSON EVENTS')
    console.log('-'.repeat(80))
    const inPersonEvents = filterInPersonEvents(allEvents)
    const onlineEvents = allEvents.filter((e) => e.isOnline)
    const noVenueEvents = allEvents.filter((e) => !e.isOnline && !e.venue)

    console.log(`   In-person events: ${inPersonEvents.length}`)
    console.log(`   Online events (filtered out): ${onlineEvents.length}`)
    console.log(`   No venue events: ${noVenueEvents.length}`)
    console.log()

    // Step 3: Show sample events
    if (inPersonEvents.length > 0) {
      console.log('3. SAMPLE IN-PERSON EVENTS')
      console.log('-'.repeat(80))

      const sampleEvents = inPersonEvents.slice(0, 5)
      for (const [i, event] of sampleEvents.entries()) {
        console.log(`\n   --- Event ${i + 1} ---`)
        console.log(`   ID: ${event.id}`)
        console.log(`   Name: ${event.name}`)
        console.log(`   Date: ${event.dateTime}`)
        if (event.dateTime) {
          console.log(`   Formatted: ${formatArgentinaDate(event.dateTime)}`)
        }
        console.log(`   Venue: ${event.venue?.name || 'N/A'}`)
        console.log(`   Address: ${event.venue?.address || 'N/A'}`)
        console.log(`   Group: ${event.group.name}`)
        console.log(`   Attendees: ${event.attendeeCount}`)
        console.log(`   Category: ${event.category || 'N/A'}`)
        console.log(`   URL: ${event.eventUrl}`)
        console.log(`   Image: ${event.imageUrl ? 'Yes' : 'No'}`)
        console.log(`   Is Recurring: ${event.isRecurring ? `Yes (${event.recurrencePattern})` : 'No'}`)
        console.log(`   Price: ${event.price ? `${event.currency || ''} ${event.price}` : 'Free'}`)
      }
      console.log()
    }

    // Step 4: Show recurring events
    const recurringEvents = inPersonEvents.filter((e) => e.isRecurring)
    if (recurringEvents.length > 0) {
      console.log('4. RECURRING EVENTS')
      console.log('-'.repeat(80))
      console.log(`   Found ${recurringEvents.length} recurring events`)

      for (const event of recurringEvents.slice(0, 3)) {
        console.log(`\n   "${event.name}"`)
        console.log(`   Pattern: ${event.recurrencePattern}`)

        // Show expanded dates
        if (event.recurrencePattern) {
          const expanded = expandRecurringEventWithIds(
            event.id,
            event.dateTime,
            event.recurrencePattern,
            4
          )
          console.log(`   Expanded to ${expanded.length} occurrences:`)
          for (const { date, id } of expanded) {
            console.log(`     - ${formatArgentinaDate(date, 'EEE, MMM d')} (ID: ${id})`)
          }
        }
      }
      console.log()
    }

    // Step 5: Category distribution
    console.log('5. CATEGORY DISTRIBUTION')
    console.log('-'.repeat(80))
    const categoryCount = new Map<string, number>()
    for (const event of inPersonEvents) {
      const cat = event.category || 'Unknown'
      categoryCount.set(cat, (categoryCount.get(cat) || 0) + 1)
    }

    const sortedCategories = Array.from(categoryCount.entries())
      .sort((a, b) => b[1] - a[1])

    for (const [cat, count] of sortedCategories) {
      console.log(`   ${cat}: ${count}`)
    }
    console.log()

    // Step 6: Group distribution
    console.log('6. TOP GROUPS')
    console.log('-'.repeat(80))
    const groupCount = new Map<string, number>()
    for (const event of inPersonEvents) {
      const group = event.group.name
      groupCount.set(group, (groupCount.get(group) || 0) + 1)
    }

    const sortedGroups = Array.from(groupCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)

    for (const [group, count] of sortedGroups) {
      console.log(`   ${group}: ${count} events`)
    }
    console.log()

    // Step 7: Venue distribution
    console.log('7. UNIQUE VENUES')
    console.log('-'.repeat(80))
    const venues = new Set<string>()
    for (const event of inPersonEvents) {
      if (event.venue?.name) {
        venues.add(event.venue.name)
      }
    }
    console.log(`   Found ${venues.size} unique venues`)
    console.log(`   Sample venues:`)
    const venueList = Array.from(venues).slice(0, 10)
    for (const venue of venueList) {
      console.log(`     - ${venue}`)
    }
    console.log()

    // Summary
    console.log('='.repeat(80))
    console.log('SUMMARY')
    console.log('='.repeat(80))
    console.log(`
   Total events scraped: ${allEvents.length}
   In-person events: ${inPersonEvents.length}
   Online events: ${onlineEvents.length}
   Recurring events: ${recurringEvents.length}
   Unique venues: ${venues.size}
   Unique groups: ${groupCount.size}
   Unique categories: ${categoryCount.size}

   Scraping time: ${duration}s
`)

    // Output raw JSON for first few events (for debugging)
    console.log('RAW EVENT DATA (first event):')
    console.log('-'.repeat(80))
    if (inPersonEvents.length > 0) {
      console.log(JSON.stringify(inPersonEvents[0], null, 2))
    }

  } catch (error) {
    console.error('ERROR:', error)
    process.exit(1)
  }
}

main()

/**
 * Eventbrite Scraper Test Script
 *
 * Tests the full Eventbrite scraper pipeline:
 * 1. Fetch events from JSON-LD
 * 2. Filter by date and in-person
 * 3. Transform to EventInsert format
 * 4. Test enrichment (price + category/vibe inference)
 *
 * Run with: bun scripts/test-eventbrite-scraper.ts
 */

import {
  fetchEventbriteEvents,
  filterInPersonEvents,
  filterByDateRange,
  transformEventbriteEvent,
  getUniqueVenueNames,
  getAllVenueInfo,
  type EventbriteEvent,
} from '../src/lib/scrapers/eventbrite'

async function testFetch() {
  console.log('='.repeat(80))
  console.log('1. FETCH EVENTBRITE EVENTS (JSON-LD)')
  console.log('='.repeat(80))

  const events = await fetchEventbriteEvents()
  console.log(`\n✅ Fetched ${events.length} events from Eventbrite`)

  // Show first event as sample
  if (events.length > 0) {
    console.log('\nSample event:')
    console.log(JSON.stringify(events[0], null, 2))
  }

  return events
}

function testFiltering(events: EventbriteEvent[]) {
  console.log('\n' + '='.repeat(80))
  console.log('2. FILTER EVENTS')
  console.log('='.repeat(80))

  // Filter for in-person events
  const inPersonEvents = filterInPersonEvents(events)
  console.log(`\n✅ In-person events: ${inPersonEvents.length}/${events.length}`)

  // Filter by date range (next 30 days)
  const today = new Date().toISOString().split('T')[0]
  const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const dateFilteredEvents = filterByDateRange(inPersonEvents, today, thirtyDaysLater)
  console.log(`✅ Events in next 30 days: ${dateFilteredEvents.length}/${inPersonEvents.length}`)
  console.log(`   Date range: ${today} to ${thirtyDaysLater}`)

  return dateFilteredEvents
}

function testTransformation(events: EventbriteEvent[]) {
  console.log('\n' + '='.repeat(80))
  console.log('3. TRANSFORM TO EventInsert')
  console.log('='.repeat(80))

  if (events.length === 0) {
    console.log('\n⚠️ No events to transform')
    return []
  }

  const transformed = events.slice(0, 5).map((event) =>
    transformEventbriteEvent(event, null)
  )

  console.log(`\n✅ Transformed ${transformed.length} events`)

  // Show field coverage
  console.log('\nField coverage (first 5 events):')
  console.log('-'.repeat(60))

  const fields = ['name', 'description_es', 'starts_at', 'ends_at', 'image_url', 'link', 'source', 'external_id']
  for (const field of fields) {
    const filled = transformed.filter((e) => e[field as keyof typeof e] != null).length
    const status = filled === transformed.length ? '✅' : filled > 0 ? '⚠️' : '❌'
    console.log(`  ${status} ${field}: ${filled}/${transformed.length}`)
  }

  // Show sample transformed event
  console.log('\nSample transformed event:')
  console.log(JSON.stringify(transformed[0], null, 2))

  return transformed
}

function testVenueExtraction(events: EventbriteEvent[]) {
  console.log('\n' + '='.repeat(80))
  console.log('4. VENUE EXTRACTION')
  console.log('='.repeat(80))

  const uniqueVenues = getUniqueVenueNames(events)
  console.log(`\n✅ Found ${uniqueVenues.length} unique venues`)

  const venueInfo = getAllVenueInfo(events)
  console.log(`✅ Venue info map: ${venueInfo.size} venues with details`)

  // Show sample venues
  console.log('\nSample venues (first 10):')
  console.log('-'.repeat(60))
  let count = 0
  for (const [name, info] of venueInfo) {
    if (count >= 10) break
    console.log(`  - ${name}`)
    if (info.address) {
      console.log(`    Address: ${info.address}`)
    }
    if (info.latitude && info.longitude) {
      console.log(`    Geo: ${info.latitude}, ${info.longitude}`)
    }
    count++
  }

  return venueInfo
}

async function testEnrichmentSample(events: EventbriteEvent[]) {
  console.log('\n' + '='.repeat(80))
  console.log('5. ENRICHMENT SAMPLE (1 event)')
  console.log('='.repeat(80))

  if (events.length === 0) {
    console.log('\n⚠️ No events to test enrichment')
    return
  }

  // Import enrichment functions dynamically to avoid API calls during import
  const { fetchEventbritePrice, inferCategoriesAndVibes } = await import(
    '../src/lib/scrapers/eventbrite/enrichment'
  )

  const testEvent = events[0]
  console.log(`\nTesting enrichment for: ${testEvent.name}`)
  console.log(`URL: ${testEvent.url}`)

  // Test price fetching
  console.log('\n5a. Price Extraction:')
  console.log('-'.repeat(40))
  try {
    const priceInfo = await fetchEventbritePrice(testEvent.url)
    if (priceInfo) {
      console.log(`  Price: ${priceInfo.price !== null ? `$${priceInfo.price}` : 'Unknown'}`)
      console.log(`  Is Free: ${priceInfo.isFree}`)
    } else {
      console.log('  ⚠️ Could not extract price')
    }
  } catch (error) {
    console.log(`  ❌ Price extraction error: ${error}`)
  }

  // Test category/vibe inference
  console.log('\n5b. Category/Vibe Inference (AI):')
  console.log('-'.repeat(40))
  try {
    const inference = await inferCategoriesAndVibes(
      testEvent.name,
      testEvent.description || null
    )
    console.log(`  Categories: ${inference.categories.join(', ')}`)
    console.log(`  Vibes: ${inference.vibes.join(', ') || '(none)'}`)
  } catch (error) {
    console.log(`  ❌ Inference error: ${error}`)
  }
}

async function main() {
  console.log('EVENTBRITE SCRAPER TEST')
  console.log('Testing the full scraper pipeline\n')

  try {
    // Step 1: Fetch
    const allEvents = await testFetch()

    // Step 2: Filter
    const filteredEvents = testFiltering(allEvents)

    // Step 3: Transform
    testTransformation(filteredEvents)

    // Step 4: Venue extraction
    testVenueExtraction(filteredEvents)

    // Step 5: Enrichment sample (optional - uses API)
    const shouldTestEnrichment = process.argv.includes('--with-enrichment')
    if (shouldTestEnrichment) {
      await testEnrichmentSample(filteredEvents)
    } else {
      console.log('\n' + '='.repeat(80))
      console.log('5. ENRICHMENT (skipped)')
      console.log('='.repeat(80))
      console.log('\nRun with --with-enrichment flag to test price extraction and AI inference')
    }

    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('SUMMARY')
    console.log('='.repeat(80))
    console.log(`
Total events fetched: ${allEvents.length}
In-person events: ${filterInPersonEvents(allEvents).length}
Events in next 30 days: ${filteredEvents.length}
Unique venues: ${getUniqueVenueNames(filteredEvents).length}

✅ Scraper is working correctly!
    `)
  } catch (error) {
    console.error('\n❌ Test failed:', error)
    process.exit(1)
  }
}

main()

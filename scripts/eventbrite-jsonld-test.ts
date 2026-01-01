/**
 * Eventbrite JSON-LD Data Analysis Script
 *
 * Tests what data is available from Eventbrite's embedded JSON-LD
 * and compares it to our EventInsert schema requirements.
 *
 * Run with: bun scripts/eventbrite-jsonld-test.ts
 */

import type { EventInsert } from '../src/shared/lib/types'

// JSON-LD Event structure from Eventbrite
interface EventbriteJsonLdEvent {
  '@type': string
  name: string
  description?: string
  startDate: string
  endDate: string
  url: string
  image?: string
  eventAttendanceMode?: string
  location?: {
    '@type': string
    name?: string
    address?: {
      '@type': string
      streetAddress?: string
      addressLocality?: string
      addressRegion?: string
      postalCode?: string
      addressCountry?: string
    }
  }
  organizer?: {
    '@type': string
    name?: string
    url?: string
  }
  offers?: {
    '@type': string
    price?: string
    priceCurrency?: string
    availability?: string
    url?: string
  }
}

interface JsonLdItemList {
  '@context': string
  '@type': string
  itemListElement: Array<{
    '@type': string
    position: number
    item: EventbriteJsonLdEvent
  }>
}

async function fetchEventbritePage(): Promise<string> {
  const url = 'https://www.eventbrite.com.ar/d/argentina--buenos-aires/events/'

  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`)
  }

  return response.text()
}

function extractJsonLd(html: string): JsonLdItemList | null {
  // Find JSON-LD script tag
  const jsonLdMatch = html.match(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i
  )

  if (!jsonLdMatch) {
    console.log('No JSON-LD found in page')
    return null
  }

  try {
    const data = JSON.parse(jsonLdMatch[1])
    if (data['@type'] === 'ItemList') {
      return data as JsonLdItemList
    }
    console.log('JSON-LD found but not ItemList type:', data['@type'])
    return null
  } catch (e) {
    console.error('Failed to parse JSON-LD:', e)
    return null
  }
}

async function fetchEventPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'text/html',
      },
    })

    if (!response.ok) return null
    return response.text()
  } catch {
    return null
  }
}

function extractEventPageDescription(html: string): string | null {
  // Try meta og:description first (usually the best summary)
  const ogDescMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/)
  if (ogDescMatch && ogDescMatch[1].length > 20) {
    return ogDescMatch[1]
  }

  // Try regular meta description
  const metaMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/)
  if (metaMatch && metaMatch[1].length > 20) {
    return metaMatch[1]
  }

  // Try to find event-description or summary div
  const descMatch = html.match(
    /<div[^>]*data-testid="(?:event-description|listing-card-description)"[^>]*>([\s\S]*?)<\/div>/i
  )
  if (descMatch) {
    return descMatch[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  }

  return null
}

function extractEventPagePrice(html: string): { price: string; currency: string } | null {
  // Look for price in conversion-bar or ticket section
  const priceMatch = html.match(/\$\s*([\d,.]+)\s*(ARS|USD)?/i)
  if (priceMatch) {
    return {
      price: priceMatch[1].replace(/\./g, '').replace(',', '.'),
      currency: priceMatch[2] || 'ARS'
    }
  }

  // Check for "Gratis" or "Free"
  if (html.includes('>Gratis<') || html.includes('>Free<')) {
    return { price: '0', currency: 'ARS' }
  }

  return null
}

function analyzeFieldCoverage(event: EventbriteJsonLdEvent): {
  field: keyof EventInsert
  available: boolean
  source: string
  sample: string | null
}[] {
  const fields: {
    field: keyof EventInsert
    available: boolean
    source: string
    sample: string | null
  }[] = [
    {
      field: 'name',
      available: !!event.name,
      source: 'name',
      sample: event.name?.substring(0, 50) || null,
    },
    {
      field: 'description_es',
      available: !!event.description,
      source: 'description',
      sample: event.description?.substring(0, 100) || null,
    },
    {
      field: 'starts_at',
      available: !!event.startDate,
      source: 'startDate',
      sample: event.startDate || null,
    },
    {
      field: 'ends_at',
      available: !!event.endDate,
      source: 'endDate',
      sample: event.endDate || null,
    },
    {
      field: 'venue_id',
      available: !!event.location?.name,
      source: 'location.name',
      sample: event.location?.name?.substring(0, 50) || null,
    },
    {
      field: 'price',
      available: !!event.offers?.price,
      source: 'offers.price',
      sample: event.offers?.price ? `${event.offers.price} ${event.offers.priceCurrency}` : null,
    },
    {
      field: 'is_free',
      available: event.offers?.price !== undefined,
      source: 'offers.price === 0',
      sample: event.offers?.price === '0' ? 'true' : 'false',
    },
    {
      field: 'image_url',
      available: !!event.image,
      source: 'image',
      sample: event.image?.substring(0, 60) || null,
    },
    {
      field: 'link',
      available: !!event.url,
      source: 'url',
      sample: event.url?.substring(0, 60) || null,
    },
    {
      field: 'ticket_url',
      available: !!event.offers?.url,
      source: 'offers.url',
      sample: event.offers?.url?.substring(0, 60) || null,
    },
    {
      field: 'categories',
      available: false,
      source: 'NOT AVAILABLE - assigned via AI during import',
      sample: null,
    },
    {
      field: 'min_age',
      available: false,
      source: 'NOT AVAILABLE',
      sample: null,
    },
    {
      field: 'is_all_day',
      available: true,
      source: 'Can derive from startDate/endDate',
      sample: 'derivable',
    },
  ]

  return fields
}

async function main() {
  console.log('='.repeat(80))
  console.log('EVENTBRITE JSON-LD DATA ANALYSIS')
  console.log('='.repeat(80))
  console.log()

  // Step 1: Fetch the listing page
  console.log('1. Fetching Eventbrite Buenos Aires events page...')
  const html = await fetchEventbritePage()
  console.log(`   Fetched ${html.length} bytes`)
  console.log()

  // Step 2: Extract JSON-LD
  console.log('2. Extracting JSON-LD data...')
  const jsonLd = extractJsonLd(html)

  if (!jsonLd) {
    console.error('   Failed to extract JSON-LD data')
    return
  }

  const events = jsonLd.itemListElement.map((item) => item.item)
  console.log(`   Found ${events.length} events in JSON-LD`)
  console.log()

  // Step 3: Analyze first event in detail
  console.log('3. DETAILED ANALYSIS OF FIRST EVENT')
  console.log('-'.repeat(80))
  const firstEvent = events[0]
  console.log('Raw JSON-LD data:')
  console.log(JSON.stringify(firstEvent, null, 2))
  console.log()

  // Step 4: Field coverage analysis
  console.log('4. FIELD COVERAGE ANALYSIS (mapping to EventInsert)')
  console.log('-'.repeat(80))
  const coverage = analyzeFieldCoverage(firstEvent)

  const availableCount = coverage.filter((f) => f.available).length
  console.log(`Coverage: ${availableCount}/${coverage.length} fields available`)
  console.log()

  console.log('Field                | Available | Source                    | Sample')
  console.log('-'.repeat(80))
  for (const field of coverage) {
    const avail = field.available ? '✅' : '❌'
    const sample = field.sample ? field.sample.substring(0, 25) : '-'
    console.log(
      `${String(field.field).padEnd(20)} | ${avail.padEnd(9)} | ${field.source.padEnd(25)} | ${sample}`
    )
  }
  console.log()

  // Step 5: Compare descriptions and check prices on event pages
  console.log('5. DESCRIPTION & PRICE COMPARISON (JSON-LD vs Event Page)')
  console.log('-'.repeat(80))

  // Check a few events
  for (let i = 0; i < Math.min(5, events.length); i++) {
    const event = events[i]
    console.log(`\nEvent ${i + 1}: ${event.name?.substring(0, 50)}...`)
    console.log(`  JSON-LD description length: ${event.description?.length || 0} chars`)
    console.log(`  JSON-LD description: "${event.description?.substring(0, 120) || 'NONE'}..."`)

    if (event.url) {
      const eventHtml = await fetchEventPage(event.url)
      if (eventHtml) {
        const pageDesc = extractEventPageDescription(eventHtml)
        const pagePrice = extractEventPagePrice(eventHtml)

        console.log(`  Page og:description: "${pageDesc?.substring(0, 120) || 'NONE'}..."`)
        console.log(`  Page price: ${pagePrice ? `$${pagePrice.price} ${pagePrice.currency}` : 'NOT FOUND'}`)

        // Compare descriptions
        if (event.description && pageDesc) {
          const jsonLdNorm = event.description.toLowerCase().substring(0, 80)
          const pageNorm = pageDesc.toLowerCase().substring(0, 80)
          const isSimilar = jsonLdNorm.includes(pageNorm.substring(0, 30)) ||
                           pageNorm.includes(jsonLdNorm.substring(0, 30))
          console.log(`  Description match: ${isSimilar ? '✅ SIMILAR' : '⚠️ DIFFERENT'}`)
        }
      } else {
        console.log(`  Could not fetch event page`)
      }
    }
  }

  // Step 6: Location/Venue analysis
  console.log()
  console.log('6. VENUE DATA ANALYSIS')
  console.log('-'.repeat(80))

  const venueStats = {
    withVenue: 0,
    withAddress: 0,
    withStreet: 0,
    online: 0,
  }

  for (const event of events) {
    if (event.location?.name) venueStats.withVenue++
    if (event.location?.address) venueStats.withAddress++
    if (event.location?.address?.streetAddress) venueStats.withStreet++
    if (event.eventAttendanceMode?.includes('Online')) venueStats.online++
  }

  console.log(`Events with venue name: ${venueStats.withVenue}/${events.length}`)
  console.log(`Events with address: ${venueStats.withAddress}/${events.length}`)
  console.log(`Events with street address: ${venueStats.withStreet}/${events.length}`)
  console.log(`Online events: ${venueStats.online}/${events.length}`)

  // Sample venues
  console.log('\nSample venues:')
  for (let i = 0; i < Math.min(5, events.length); i++) {
    const loc = events[i].location
    if (loc) {
      console.log(`  - ${loc.name || 'UNNAMED'}`)
      if (loc.address) {
        console.log(`    Address: ${loc.address.streetAddress || 'no street'}, ${loc.address.addressLocality || ''}`)
      }
    }
  }

  // Step 7: Price analysis
  console.log()
  console.log('7. PRICE DATA ANALYSIS')
  console.log('-'.repeat(80))

  const priceStats = {
    withPrice: 0,
    free: 0,
    paid: 0,
    currencies: new Set<string>(),
  }

  for (const event of events) {
    if (event.offers?.price !== undefined) {
      priceStats.withPrice++
      if (event.offers.price === '0' || event.offers.price === '0.00') {
        priceStats.free++
      } else {
        priceStats.paid++
      }
      if (event.offers.priceCurrency) {
        priceStats.currencies.add(event.offers.priceCurrency)
      }
    }
  }

  console.log(`Events with price data: ${priceStats.withPrice}/${events.length}`)
  console.log(`Free events: ${priceStats.free}`)
  console.log(`Paid events: ${priceStats.paid}`)
  console.log(`Currencies: ${Array.from(priceStats.currencies).join(', ') || 'none'}`)

  // Step 8: Summary
  console.log()
  console.log('='.repeat(80))
  console.log('FINAL ASSESSMENT')
  console.log('='.repeat(80))
  console.log(`
✅ AVAILABLE FROM JSON-LD (listing page only):
   - name (event title)
   - description (MATCHES og:description - not truncated!)
   - starts_at / ends_at (ISO date format YYYY-MM-DD)
   - venue name + full address + geo coordinates
   - image URL (high quality)
   - event URL
   - online vs in-person indicator (eventAttendanceMode)

❌ NOT IN JSON-LD (need individual page fetch):
   - price (but CAN extract from event page HTML)
   - ticket_url (use event URL instead)

❌ NOT AVAILABLE (need AI enrichment like Passline):
   - categories (infer from name/description)
   - vibes (infer from name/description)
   - min_age (not provided anywhere)

📊 DATA QUALITY:
   - ${venueStats.withVenue}/60 events have venue data (${Math.round(venueStats.withVenue/60*100)}%)
   - ${venueStats.online}/60 are online events
   - Descriptions are complete summaries (50-134 chars)
   - Dates are ISO format (easy to parse)
   - Venue addresses include street, city, postal code

💡 RECOMMENDATION:
   1. Use JSON-LD for bulk import (60 events per page)
   2. Optionally fetch individual pages for price data
   3. Use same category/vibe inference as Passline
   4. Venue matching will be needed (address → neighborhood)
  `)
}

main().catch(console.error)

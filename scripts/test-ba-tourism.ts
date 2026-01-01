import { scrapeBATourismEventsWithBrowser } from '../src/features/import/scrapers/ba-tourism'

async function test() {
  console.log('Starting BA Tourism browser scraper test...')
  try {
    const result = await scrapeBATourismEventsWithBrowser()
    console.log('Events found:', result.events.length)
    console.log('Week context:', result.weekContext)
    if (result.events.length > 0) {
      console.log('\nFirst 3 events:')
      result.events.slice(0, 3).forEach((event, i) => {
        console.log(`\n--- Event ${i + 1} ---`)
        console.log('Name:', event.name)
        console.log('Category:', event.category)
        console.log('When:', event.whenText)
        console.log('Venue:', event.venueName)
        console.log('Neighborhood:', event.neighborhood)
      })
    }
  } catch (error) {
    console.error('Error:', error)
  }
}

test()

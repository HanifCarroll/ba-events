/**
 * BA Tourism Website Scraper
 *
 * Fetches and parses events from turismo.buenosaires.gob.ar
 */

import * as cheerio from 'cheerio'
import { Effect } from 'effect'
import type { BATourismEvent, Coordinates, WeekContext } from './types.ts'
import { parseWeekContext } from './date-parser.ts'

const BA_TOURISM_URL = 'https://turismo.buenosaires.gob.ar/es/article/que-hacer-esta-semana'

/**
 * Fetch the BA Tourism events page HTML
 */
export async function fetchBATourismPage(): Promise<string> {
  const program = Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(BA_TOURISM_URL, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
        },
      }),
      catch: (error) => new BATourismFetchError(error instanceof Error ? error.message : String(error)),
    })
    if (!response.ok) {
      return yield* Effect.fail(new BATourismFetchError(
        `Failed to fetch BA Tourism page: ${response.status} ${response.statusText}`
      ))
    }
    return yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (error) => new BATourismFetchError(error instanceof Error ? error.message : String(error)),
    })
  })
  return Effect.runPromise(program)
}

class BATourismFetchError extends Error {
  readonly _tag = 'BATourismFetchError'
}

/**
 * Extract coordinates from Google Maps URL
 * Format: https://www.google.com/maps?q=-34.601152,-58.3833278
 */
function extractCoordinates(url: string | undefined): Coordinates | null {
  if (!url) return null

  const match = url.match(/maps\?q=(-?\d+\.?\d*),(-?\d+\.?\d*)/)
  if (match) {
    return {
      lat: parseFloat(match[1]),
      lng: parseFloat(match[2]),
    }
  }

  return null
}

/**
 * Parse category and price from heading like "[  Evento   | - ]" or "[  Visita guiada   | Gratis ]"
 */
function parseCategoryHeading(text: string): { category: string; isFree: boolean } {
  // Remove brackets and extra whitespace, then split by |
  const cleaned = text.replace(/[\[\]]/g, '').trim()
  const parts = cleaned.split('|').map((p) => p.trim())

  const category = parts[0] || 'Evento'
  const priceIndicator = parts[1] || '-'
  const isFree = priceIndicator.toLowerCase() === 'gratis'

  return { category, isFree }
}

/**
 * Extract venue name, address, and neighborhood from venue text
 * Format: "Teatro Colón  Cerrito 618, San Nicolás" or "La Rural  Av Santa Fe y Thames, Palermo"
 * - Double space separates venue name from address
 * - Last comma separates address from neighborhood
 */
function parseVenueText(text: string): { venueName: string; address: string | null; neighborhood: string } {
  // The format is: "VenueName  Address, Neighborhood"
  // First, split by the last comma to get neighborhood
  const lastCommaIdx = text.lastIndexOf(',')

  if (lastCommaIdx > 0) {
    const neighborhood = text.slice(lastCommaIdx + 1).trim()
    const beforeNeighborhood = text.slice(0, lastCommaIdx).trim()

    // The venue name is before the double space or the first word(s)
    // Look for double space which separates venue from address
    const doubleSpaceIdx = beforeNeighborhood.indexOf('  ')
    if (doubleSpaceIdx > 0) {
      const venueName = beforeNeighborhood.slice(0, doubleSpaceIdx).trim()
      const address = beforeNeighborhood.slice(doubleSpaceIdx).trim()
      return {
        venueName,
        address: address || null,
        neighborhood,
      }
    }

    return {
      venueName: beforeNeighborhood,
      address: null,
      neighborhood,
    }
  }

  return {
    venueName: text.trim(),
    address: null,
    neighborhood: 'CABA',
  }
}

/**
 * Parse the week context from page header
 */
export function extractWeekContext(html: string): WeekContext {
  const $ = cheerio.load(html)

  // Look for the paragraph with "Desde el lunes X al domingo Y de MONTH"
  let headerText = ''
  $('p').each((_, el) => {
    const text = $(el).text()
    if (text.toLowerCase().includes('desde el')) {
      headerText = text
      return false // break
    }
  })

  return parseWeekContext(headerText)
}

/**
 * Parse all events from the BA Tourism HTML
 */
export function parseBATourismEvents(html: string): BATourismEvent[] {
  const $ = cheerio.load(html)
  const events: BATourismEvent[] = []

  // Events are in .card-landing divs
  $('.card-landing').each((_, card) => {
    const $card = $(card)

    // Get event name from h2
    const name = $card.find('h2').first().text().trim()
    if (!name) return // skip if no name

    // Get category from .media-heading (h4)
    const categoryText = $card.find('.media-heading').text().trim()
    const { category, isFree } = parseCategoryHeading(categoryText)

    // Find ¿Cuándo? and ¿Dónde? sections
    let whenText = ''
    let dondeText = ''

    const paragraphs = $card.find('p')
    paragraphs.each((i, p) => {
      const text = $(p).text().trim()
      if (text === '¿Cuándo?') {
        // Next paragraph has the date
        const nextP = paragraphs.eq(i + 1)
        if (nextP.length) {
          whenText = nextP.text().trim()
        }
      }
      if (text === '¿Dónde?') {
        // Next paragraph has the venue
        const nextP = paragraphs.eq(i + 1)
        if (nextP.length) {
          dondeText = nextP.text().trim()
        }
      }
    })

    // Parse venue info (includes address from donde text)
    const { venueName, address: parsedAddress, neighborhood } = parseVenueText(dondeText)

    // Get Google Maps link for coordinates (and fallback address)
    const mapsLink = $card.find('a[href*="google.com/maps"]').first()
    const mapsAddress = mapsLink.text().trim() || null
    const coordinates = extractCoordinates(mapsLink.attr('href'))

    // Use parsed address from donde text, or fall back to Google Maps link text
    const address = parsedAddress || mapsAddress

    // Get "Más información" link
    let moreInfoUrl = ''
    $card.find('a').each((_, link) => {
      const linkText = $(link).text().toLowerCase()
      if (linkText.includes('más información')) {
        moreInfoUrl = $(link).attr('href') || ''
        return false // break
      }
    })

    // Get description - find the longest paragraph after ¿Dónde? that's not a link
    let description = ''
    let foundDonde = false
    paragraphs.each((_, p) => {
      const $p = $(p)
      const text = $p.text().trim()

      if (text === '¿Dónde?') {
        foundDonde = true
        return // continue to next
      }

      // Skip if not past ¿Dónde?
      if (!foundDonde) return

      // Skip short text, the venue line, and "Más información" links
      if (
        text.length > 50 &&
        !text.toLowerCase().includes('más información') &&
        text !== dondeText &&
        !description // only take the first matching paragraph
      ) {
        description = text
      }
    })

    // Skip non-event sections (like "Para disfrutar todos los días", etc.)
    const skipNames = [
      'para disfrutar',
      'visitas, paseos',
      'imperdibles',
      'turismo en barrios',
      'destacar en el listado',
    ]
    if (skipNames.some((skip) => name.toLowerCase().includes(skip))) {
      return // skip this card
    }

    // Only add if we have essential data
    if (name && whenText) {
      events.push({
        name,
        category,
        isFree,
        whenText,
        venueName: venueName || 'Ubicación no especificada',
        neighborhood: neighborhood || 'CABA',
        address,
        coordinates,
        description,
        moreInfoUrl,
      })
    }
  })

  return events
}

/**
 * Main scraper function - fetches and parses all events
 */
export async function scrapeBATourismEvents(): Promise<{
  events: BATourismEvent[]
  weekContext: WeekContext
}> {
  const html = await fetchBATourismPage()
  const weekContext = extractWeekContext(html)
  const events = parseBATourismEvents(html)

  return { events, weekContext }
}

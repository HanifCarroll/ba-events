/**
 * Meetup Browser Scraper
 *
 * Uses Playwright to load the Meetup events page and intercept GraphQL responses.
 * This provides structured JSON data while handling client-side rendering.
 *
 * Supports two modes:
 * - Local: Uses Playwright with local Chromium (development)
 * - Browserless: Connects to Browserless.io (production/serverless)
 */

import type { Page } from 'playwright'
import type { MeetupEvent, MeetupGraphQLEvent } from './types'
import { extractRecurrencePattern, isRecurringEvent } from './date-parser'

const MEETUP_BUENOS_AIRES_URL =
  'https://www.meetup.com/find/?location=ar--Buenos%20Aires&source=EVENTS'

/**
 * Parse GraphQL response to extract events
 * The structure varies based on the query, so we try multiple paths
 */
function parseGraphQLResponse(data: unknown): MeetupEvent[] {
  if (!data || typeof data !== 'object') return []

  const events: MeetupEvent[] = []

  // Helper to recursively find event arrays
  const findEvents = (obj: unknown, depth: number = 0): void => {
    if (depth > 10 || !obj || typeof obj !== 'object') return

    // Check if this is an event object
    if (isEventLike(obj)) {
      const event = transformGraphQLEvent(obj as MeetupGraphQLEvent)
      if (event) events.push(event)
      return
    }

    // Check arrays
    if (Array.isArray(obj)) {
      for (const item of obj) {
        findEvents(item, depth + 1)
      }
      return
    }

    // Check object properties
    for (const value of Object.values(obj)) {
      findEvents(value, depth + 1)
    }
  }

  findEvents(data)
  return events
}

/**
 * Check if an object looks like a Meetup event
 */
function isEventLike(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false
  const o = obj as Record<string, unknown>

  // Must have title or name and dateTime
  const hasTitle = typeof o.title === 'string' || typeof o.name === 'string'
  const hasDateTime = typeof o.dateTime === 'string' || typeof o.startDateTime === 'string'
  const hasEventUrl = typeof o.eventUrl === 'string' || typeof o.link === 'string'

  return hasTitle && hasDateTime && hasEventUrl
}

/**
 * Transform GraphQL event data to our MeetupEvent format
 */
function transformGraphQLEvent(gqlEvent: MeetupGraphQLEvent): MeetupEvent | null {
  if (!gqlEvent.title && !gqlEvent.id) return null

  const dateTimeStr = gqlEvent.dateTime || ''
  const isRecurring = isRecurringEvent(dateTimeStr)
  const recurrencePattern = isRecurring ? extractRecurrencePattern(dateTimeStr) : null

  // Get venue from GraphQL data if available
  const venue: MeetupEvent['venue'] = gqlEvent.venue
    ? {
        name: gqlEvent.venue.name,
        address: gqlEvent.venue.address || null,
        city: gqlEvent.venue.city || 'Buenos Aires',
        lat: gqlEvent.venue.lat || null,
        lng: gqlEvent.venue.lng || null,
      }
    : null

  return {
    id: gqlEvent.id || `meetup-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: gqlEvent.title,
    description: gqlEvent.description || null,
    dateTime: gqlEvent.dateTime,
    endTime: gqlEvent.endTime || null,
    timezone: gqlEvent.timezone || 'America/Argentina/Buenos_Aires',
    eventUrl: gqlEvent.eventUrl,
    imageUrl: gqlEvent.imageUrl || null,
    isOnline: gqlEvent.isOnline ?? false,
    venue,
    group: {
      name: gqlEvent.group?.name || 'Unknown Group',
      urlname: gqlEvent.group?.urlname || '',
      rating: gqlEvent.group?.rating || null,
    },
    attendeeCount: gqlEvent.going || 0,
    category: gqlEvent.eventType || null,
    isRecurring,
    recurrencePattern,
    price: gqlEvent.feeSettings?.amount || null,
    currency: gqlEvent.feeSettings?.currency || null,
  }
}

/**
 * DOM extraction script to run in browser context
 * Used as fallback if GraphQL interception doesn't capture events
 *
 * Parses the innerText of event links which has this structure:
 * Line 1: Date (e.g., "Every Wed • Jan 7, 2026 · 8:30 PM BRT" or "Mon, Jan 5, 2026 · 7:00 PM ART")
 * Line 2: "•" (bullet separator)
 * Line 3: "Online" (if online event) or empty
 * Line 4: Event name
 * Line 5: "by [Group Name]"
 * Line 6: Rating (e.g., "4.7") - optional
 * Line 7: "X attendees"
 */
const domExtractionScript = (): Array<{
  id: string
  name: string
  dateTime: string
  eventUrl: string
  imageUrl: string | null
  venueName: string | null
  groupName: string
  groupRating: number | null
  attendeeCount: number
  isOnline: boolean
  category: string | null
}> => {
  const events: Array<{
    id: string
    name: string
    dateTime: string
    eventUrl: string
    imageUrl: string | null
    venueName: string | null
    groupName: string
    groupRating: number | null
    attendeeCount: number
    isOnline: boolean
    category: string | null
  }> = []

  // Find all event links - they have href containing /events/ and a numeric ID
  const eventLinks = document.querySelectorAll('a[href*="/events/"]')

  const seenIds = new Set<string>()

  eventLinks.forEach((linkEl) => {
    try {
      const anchor = linkEl as HTMLAnchorElement
      const eventUrl = anchor.href

      // Extract event ID from URL
      const idMatch = eventUrl.match(/events\/(\d+)/)
      if (!idMatch) return
      const id = idMatch[1]

      // Skip duplicates
      if (seenIds.has(id)) return
      seenIds.add(id)

      // Parse the innerText line by line
      const innerText = anchor.innerText || ''
      const lines = innerText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && l !== '•')

      if (lines.length < 3) return

      // First line is the date
      let dateTime = lines[0] || ''
      let isOnline = false
      let eventNameIndex = 1

      // Check if "Online" indicator is present
      if (lines[1] === 'Online') {
        isOnline = true
        eventNameIndex = 2
      }

      // Event name
      const name = lines[eventNameIndex] || ''
      if (!name) return

      // Group name - look for "by ..."
      let groupName = 'Unknown Group'
      let groupRating: number | null = null
      let attendeeCount = 0

      for (let i = eventNameIndex + 1; i < lines.length; i++) {
        const line = lines[i]

        if (line.startsWith('by ')) {
          groupName = line.slice(3).trim()
        } else if (/^\d\.\d$/.test(line)) {
          groupRating = parseFloat(line)
        } else if (/^\d+\s*attendees?$/i.test(line)) {
          const match = line.match(/(\d+)/)
          if (match) {
            attendeeCount = parseInt(match[1], 10)
          }
        }
      }

      // Image
      const imgEl = anchor.querySelector('img') as HTMLImageElement
      const imageUrl = imgEl?.src || null

      // Parse the date string to ISO format if possible
      let parsedDateTime = dateTime
      // Try to parse dates like "Mon, Jan 5, 2026 · 7:00 PM ART"
      const dateMatch = dateTime.match(
        /(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})\s+[·•]\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i
      )
      if (dateMatch) {
        const [, , monthStr, day, year, hour, min, ampm] = dateMatch
        const months: Record<string, number> = {
          Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
          Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
        }
        let hours = parseInt(hour, 10)
        if (ampm.toUpperCase() === 'PM' && hours !== 12) hours += 12
        if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0

        const date = new Date(
          parseInt(year, 10),
          months[monthStr],
          parseInt(day, 10),
          hours,
          parseInt(min, 10)
        )
        if (!isNaN(date.getTime())) {
          parsedDateTime = date.toISOString()
        }
      }

      events.push({
        id,
        name,
        dateTime: parsedDateTime,
        eventUrl,
        imageUrl,
        venueName: null, // Not available in list view
        groupName,
        groupRating,
        attendeeCount,
        isOnline,
        category: null,
      })
    } catch {
      // Skip malformed cards
    }
  })

  return events
}

/**
 * Auto-scroll to load more events
 */
async function autoScroll(page: Page, maxScrolls: number = 5): Promise<void> {
  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight)
    })
    // Wait for content to load
    await page.waitForTimeout(1500)
  }
  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0))
}

/**
 * Scrape events using local Playwright
 */
async function scrapeWithPlaywright(): Promise<MeetupEvent[]> {
  const { chromium } = await import('playwright')

  const browser = await chromium.launch({
    headless: true,
  })

  const collectedEvents: MeetupEvent[] = []
  const seenIds = new Set<string>()

  try {
    const page = await browser.newPage()

    // Intercept GraphQL responses
    page.on('response', async (response) => {
      const url = response.url()
      if (url.includes('graphql') || url.includes('gql-')) {
        try {
          const json = await response.json()
          const events = parseGraphQLResponse(json)
          for (const event of events) {
            if (!seenIds.has(event.id)) {
              seenIds.add(event.id)
              collectedEvents.push(event)
            }
          }
        } catch {
          // Not JSON or parsing failed
        }
      }
    })

    console.log('[Meetup] Navigating to page...')
    await page.goto(MEETUP_BUENOS_AIRES_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })

    // Wait for additional content to load
    await page.waitForTimeout(5000)

    // Wait for initial content - events are links with /events/ in href
    console.log('[Meetup] Waiting for events to load...')
    await page.waitForSelector('a[href*="/events/"]', {
      timeout: 30000,
    }).catch(() => {
      console.log('[Meetup] Event links not found yet...')
    })

    // Scroll to trigger more GraphQL requests
    console.log('[Meetup] Scrolling to load more events...')
    await autoScroll(page, 5)

    // Wait for any pending requests
    await page.waitForTimeout(3000)

    console.log(`[Meetup] Collected ${collectedEvents.length} events from GraphQL`)

    // If GraphQL didn't capture many events, try DOM extraction
    if (collectedEvents.length < 5) {
      console.log('[Meetup] Trying DOM extraction fallback...')
      const domEvents = await page.evaluate(domExtractionScript)
      console.log(`[Meetup] DOM extraction found ${domEvents.length} events`)

      for (const domEvent of domEvents) {
        if (!seenIds.has(domEvent.id)) {
          seenIds.add(domEvent.id)
          collectedEvents.push({
            id: domEvent.id,
            name: domEvent.name,
            description: null,
            dateTime: domEvent.dateTime,
            endTime: null,
            timezone: 'America/Argentina/Buenos_Aires',
            eventUrl: domEvent.eventUrl,
            imageUrl: domEvent.imageUrl,
            isOnline: domEvent.isOnline,
            venue: domEvent.venueName
              ? {
                  name: domEvent.venueName,
                  address: null,
                  city: 'Buenos Aires',
                  lat: null,
                  lng: null,
                }
              : null,
            group: {
              name: domEvent.groupName,
              urlname: '',
              rating: domEvent.groupRating,
            },
            attendeeCount: domEvent.attendeeCount,
            category: domEvent.category,
            isRecurring: isRecurringEvent(domEvent.dateTime),
            recurrencePattern: extractRecurrencePattern(domEvent.dateTime),
            price: null,
            currency: null,
          })
        }
      }
    }

    return collectedEvents
  } finally {
    await browser.close()
  }
}

/**
 * Scrape events using Browserless (production/serverless mode)
 */
async function scrapeWithBrowserless(token: string): Promise<MeetupEvent[]> {
  const puppeteer = await import('puppeteer-core')

  const browser = await puppeteer.default.connect({
    browserWSEndpoint: `wss://chrome.browserless.io?token=${token}`,
  })

  const collectedEvents: MeetupEvent[] = []
  const seenIds = new Set<string>()

  try {
    const page = await browser.newPage()

    // Note: Puppeteer response handling is slightly different
    page.on('response', async (response) => {
      const url = response.url()
      if (url.includes('graphql') || url.includes('gql-')) {
        try {
          const json = await response.json()
          const events = parseGraphQLResponse(json)
          for (const event of events) {
            if (!seenIds.has(event.id)) {
              seenIds.add(event.id)
              collectedEvents.push(event)
            }
          }
        } catch {
          // Not JSON or parsing failed
        }
      }
    })

    await page.goto(MEETUP_BUENOS_AIRES_URL, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    })

    // Wait and scroll
    await new Promise((r) => setTimeout(r, 3000))
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight))
      await new Promise((r) => setTimeout(r, 1500))
    }
    await new Promise((r) => setTimeout(r, 3000))

    // DOM fallback
    if (collectedEvents.length < 5) {
      const domEvents = await page.evaluate(domExtractionScript)
      for (const domEvent of domEvents) {
        if (!seenIds.has(domEvent.id)) {
          seenIds.add(domEvent.id)
          collectedEvents.push({
            id: domEvent.id,
            name: domEvent.name,
            description: null,
            dateTime: domEvent.dateTime,
            endTime: null,
            timezone: 'America/Argentina/Buenos_Aires',
            eventUrl: domEvent.eventUrl,
            imageUrl: domEvent.imageUrl,
            isOnline: domEvent.isOnline,
            venue: domEvent.venueName
              ? {
                  name: domEvent.venueName,
                  address: null,
                  city: 'Buenos Aires',
                  lat: null,
                  lng: null,
                }
              : null,
            group: {
              name: domEvent.groupName,
              urlname: '',
              rating: domEvent.groupRating,
            },
            attendeeCount: domEvent.attendeeCount,
            category: domEvent.category,
            isRecurring: isRecurringEvent(domEvent.dateTime),
            recurrencePattern: extractRecurrencePattern(domEvent.dateTime),
            price: null,
            currency: null,
          })
        }
      }
    }

    return collectedEvents
  } finally {
    await browser.close()
  }
}

/**
 * Main scraper function - automatically chooses the right method
 *
 * Uses Browserless if BROWSERLESS_TOKEN env var is set,
 * otherwise falls back to local Playwright.
 */
export async function scrapeMeetupEvents(): Promise<MeetupEvent[]> {
  const browserlessToken = process.env.BROWSERLESS_TOKEN

  if (browserlessToken) {
    console.log('[Meetup] Using Browserless for scraping')
    return scrapeWithBrowserless(browserlessToken)
  }

  console.log('[Meetup] Using local Playwright for scraping')
  return scrapeWithPlaywright()
}

/**
 * Filter out online-only events
 * Note: In list view, venue data may not be available, so we only filter by isOnline flag
 */
export function filterInPersonEvents(events: MeetupEvent[]): MeetupEvent[] {
  return events.filter((event) => !event.isOnline)
}

/**
 * Filter events by date range
 */
export function filterByDateRange(
  events: MeetupEvent[],
  startDate: string,
  endDate: string
): MeetupEvent[] {
  const start = new Date(startDate)
  const end = new Date(endDate)

  return events.filter((event) => {
    const eventDate = new Date(event.dateTime)
    return eventDate >= start && eventDate <= end
  })
}

/**
 * Get extraction script for external browser contexts (e.g., Chrome MCP)
 * Returns the script as a string to be executed in browser
 */
export function getExtractionScript(): string {
  return `(${domExtractionScript.toString()})()`
}

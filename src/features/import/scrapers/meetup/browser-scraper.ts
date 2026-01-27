/**
 * Meetup Browser Scraper
 *
 * Uses Playwright to load the Meetup events page and intercept GraphQL responses.
 * This provides structured JSON data while handling client-side rendering.
 *
 * Runs in Trigger.dev with the Playwright build extension which installs Chromium
 * in the container at deploy time.
 */

import type { Page } from 'playwright'
import { parseISO, eachDayOfInterval } from 'date-fns'
import type { MeetupEvent, MeetupGraphQLEvent } from './types'
import { extractRecurrencePattern, isRecurringEvent } from './date-parser'
import { BA_TIMEZONE } from '@/shared/lib/constants'
import { sanitizeError } from '@/shared/lib/security'
import { logger } from '@/shared/lib/logger'

const MEETUP_BASE_URL = 'https://www.meetup.com/find/'

// Retry constants for frame detachment handling
const MAX_PAGE_RETRIES = 3
const RETRY_DELAY_MS = 2000

// Browser args to mitigate frame detachment issues
// --disable-features=site-per-process is the most commonly suggested workaround
// for the "Navigating frame was detached" Chromium bug
const BROWSER_ARGS = [
  '--disable-features=site-per-process',
  '--no-sandbox',
  '--disable-setuid-sandbox',
]

/**
 * Check if an error is a frame detachment error
 * These errors occur when the browser frame becomes invalid during navigation
 */
function isFrameDetachmentError(error: unknown): boolean {
  if (!error) return false
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('frame was detached') ||
    message.includes('detached Frame') ||
    message.includes('Frame has been detached') ||
    message.includes('Navigating frame was detached') ||
    message.includes('Target closed') ||
    message.includes('Session closed')
  )
}

/**
 * Build a Meetup search URL for a specific date
 * Uses customStartDate/customEndDate to get events for a single day
 */
function buildMeetupUrlForDate(date: Date): string {
  // Start of day in Buenos Aires timezone (UTC-3)
  const startOfDay = new Date(date)
  startOfDay.setHours(0, 0, 0, 0)

  // End of day
  const endOfDay = new Date(date)
  endOfDay.setHours(23, 59, 59, 999)

  // Format as ISO string with timezone offset
  const formatWithOffset = (d: Date): string => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    const seconds = String(d.getSeconds()).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}-03:00`
  }

  // Buenos Aires center coordinates
  const BA_LAT = '-34.6037'
  const BA_LON = '-58.3816'

  const params = new URLSearchParams({
    customStartDate: formatWithOffset(startOfDay),
    customEndDate: formatWithOffset(endOfDay),
    source: 'EVENTS',
    eventType: 'inPerson',
    distance: 'tenMiles',
    lat: BA_LAT,
    lon: BA_LON,
  })

  return `${MEETUP_BASE_URL}?${params.toString()}`
}

/**
 * Generate array of dates between start and end (inclusive)
 */
function getDateRange(startDateStr: string, endDateStr: string): Date[] {
  // parseISO correctly handles YYYY-MM-DD as local time
  const start = parseISO(startDateStr)
  const end = parseISO(endDateStr)
  return eachDayOfInterval({ start, end })
}

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

  // GraphQL may use either dateTime or startDateTime
  const dateTimeStr = gqlEvent.dateTime || (gqlEvent as unknown as { startDateTime?: string }).startDateTime || ''
  if (!dateTimeStr) {
    console.warn(`[Meetup] Event missing dateTime: ${gqlEvent.title || gqlEvent.id}`)
    return null
  }
  const isRecurring = isRecurringEvent(dateTimeStr)
  const recurrencePattern = isRecurring ? extractRecurrencePattern(dateTimeStr) : null

  // Get venue from GraphQL data if available
  const venue: MeetupEvent['venue'] = gqlEvent.venue
    ? {
        name: gqlEvent.venue.name,
        address: gqlEvent.venue.address || null,
        city: gqlEvent.venue.city || null, // Don't assume Buenos Aires - let validation catch bad data
        lat: gqlEvent.venue.lat || null,
        lng: gqlEvent.venue.lng || null,
      }
    : null

  return {
    id: gqlEvent.id || `meetup-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: gqlEvent.title,
    description: gqlEvent.description || null,
    dateTime: dateTimeStr,
    endTime: gqlEvent.endTime || null,
    timezone: gqlEvent.timezone || BA_TIMEZONE,
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

/** Type for the DOM extraction script result */
interface DOMExtractionResult {
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
 *
 * NOTE: This is a string to avoid Trigger.dev/esbuild bundling issues.
 * When passed as a function reference, esbuild adds __name helpers that
 * don't exist in the browser context, causing "ReferenceError: __name is not defined"
 */
const domExtractionScript = `(() => {
  const events = []

  // Find all event links - they have href containing /events/ and a numeric ID
  const eventLinks = document.querySelectorAll('a[href*="/events/"]')

  const seenIds = new Set()

  eventLinks.forEach((linkEl) => {
    try {
      const anchor = linkEl
      const eventUrl = anchor.href

      // Extract event ID from URL
      const idMatch = eventUrl.match(/events\\/(\\d+)/)
      if (!idMatch) return
      const id = idMatch[1]

      // Skip duplicates
      if (seenIds.has(id)) return
      seenIds.add(id)

      // Get date from <time> element's datetime attribute (already ISO format!)
      // Format: "2026-01-10T15:00:00-03:00[America/Argentina/Buenos_Aires]"
      const timeEl = anchor.querySelector('time')
      let dateTime = timeEl?.getAttribute('datetime') || ''
      // Strip the [timezone] suffix if present
      dateTime = dateTime.replace(/\\[.*\\]$/, '')
      if (!dateTime) return

      // Get event name from <h3> element
      const h3El = anchor.querySelector('h3')
      const name = h3El?.textContent?.trim() || ''
      if (!name) return

      // Parse innerText for additional info (group, rating, attendees, online status)
      const innerText = anchor.innerText || ''
      const lines = innerText
        .split('\\n')
        .map((l) => l.trim())
        .filter((l) => l && l !== '•')

      // Check for online indicator
      const isOnline = lines.some((line) => line === 'Online')

      // Group name - look for "by ..."
      let groupName = 'Unknown Group'
      let groupRating = null
      let attendeeCount = 0

      for (const line of lines) {
        if (line.startsWith('by ')) {
          groupName = line.slice(3).trim()
        } else if (/^\\d\\.\\d$/.test(line)) {
          groupRating = parseFloat(line)
        } else if (/^\\d+\\s*attendees?$/i.test(line)) {
          const match = line.match(/(\\d+)/)
          if (match) {
            attendeeCount = parseInt(match[1], 10)
          }
        }
      }

      // Image
      const imgEl = anchor.querySelector('img')
      const imageUrl = imgEl?.src || null

      events.push({
        id,
        name,
        dateTime,
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
})()`

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

export interface ScraperOptions {
  startDate: string
  endDate: string
}

/**
 * Scrape a single page and collect events
 */
async function scrapePageForEvents(
  page: Page,
  url: string,
  seenIds: Set<string>,
  collectedEvents: MeetupEvent[]
): Promise<void> {
  // Set up GraphQL interception for this page
  const pageEvents: MeetupEvent[] = []

  const responseHandler = async (response: { url: () => string; json: () => Promise<unknown> }) => {
    const responseUrl = response.url()
    if (responseUrl.includes('graphql') || responseUrl.includes('gql-')) {
      try {
        const json = await response.json()
        const events = parseGraphQLResponse(json)
        for (const event of events) {
          if (!seenIds.has(event.id)) {
            seenIds.add(event.id)
            pageEvents.push(event)
          }
        }
      } catch {
        // Not JSON or parsing failed
      }
    }
  }

  page.on('response', responseHandler)

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })

    // Wait for content to load
    await page.waitForTimeout(3000)

    // Wait for event links
    await page.waitForSelector('a[href*="/events/"]', {
      timeout: 15000,
    }).catch(() => {
      // No events for this day
    })

    // Scroll to load more
    await autoScroll(page, 3)

    // Wait for pending requests
    await page.waitForTimeout(2000)

    // DOM fallback if GraphQL didn't capture events
    if (pageEvents.length < 3) {
      const domEvents = (await page.evaluate(domExtractionScript)) as DOMExtractionResult[]
      for (const domEvent of domEvents) {
        if (!seenIds.has(domEvent.id)) {
          seenIds.add(domEvent.id)
          pageEvents.push({
            id: domEvent.id,
            name: domEvent.name,
            description: null,
            dateTime: domEvent.dateTime,
            endTime: null,
            timezone: BA_TIMEZONE,
            eventUrl: domEvent.eventUrl,
            imageUrl: domEvent.imageUrl,
            isOnline: domEvent.isOnline,
            venue: domEvent.venueName
              ? {
                  name: domEvent.venueName,
                  address: null,
                  city: null, // Don't assume Buenos Aires - let validation catch bad data
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

    // Add to main collection
    collectedEvents.push(...pageEvents)
  } finally {
    page.off('response', responseHandler)
  }
}

/**
 * Scrape events using local Playwright for a date range
 * Includes retry logic with page recreation for frame detachment errors
 */
async function scrapeWithPlaywright(options: ScraperOptions): Promise<MeetupEvent[]> {
  const { chromium } = await import('playwright')

  const browser = await chromium.launch({
    headless: true,
    args: BROWSER_ARGS,
  })

  const collectedEvents: MeetupEvent[] = []
  const seenIds = new Set<string>()

  try {
    let page = await browser.newPage()

    const dates = getDateRange(options.startDate, options.endDate)
    logger.info(`[Meetup] Scraping ${dates.length} days`, { startDate: options.startDate, endDate: options.endDate, daysCount: dates.length })

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i]
      const url = buildMeetupUrlForDate(date)
      const dateStr = date.toISOString().split('T')[0]

      logger.debug(`[Meetup] Scraping day ${i + 1}/${dates.length}`, { date: dateStr })

      // Retry logic with page recreation for frame detachment errors
      let success = false
      for (let retry = 0; retry < MAX_PAGE_RETRIES && !success; retry++) {
        try {
          await scrapePageForEvents(page, url, seenIds, collectedEvents)
          success = true
        } catch (error) {
          if (isFrameDetachmentError(error) && retry < MAX_PAGE_RETRIES - 1) {
            console.warn(
              `[Meetup] Frame detached for ${dateStr}, recreating page (attempt ${retry + 2}/${MAX_PAGE_RETRIES})`
            )
            // Close old page and create fresh one
            await page.close().catch(() => {})
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
            page = await browser.newPage()
          } else {
            // Non-frame error or max retries reached - log and continue
            logger.error(`[Meetup] Error scraping date`, { date: dateStr, error: sanitizeError(error) })
          }
        }
      }

      logger.debug(`[Meetup] Total events so far`, { count: collectedEvents.length })

      // Small delay between days to avoid rate limiting
      if (i < dates.length - 1) {
        await page.waitForTimeout(1000)
      }
    }

    logger.info(`[Meetup] Finished scraping`, { totalEvents: collectedEvents.length })
    return collectedEvents
  } finally {
    await browser.close()
  }
}

/**
 * Main scraper function - uses Playwright with Chromium
 *
 * In Trigger.dev production, uses the Playwright build extension which
 * pre-installs Chromium in the container.
 *
 * @param options - Date range to scrape (startDate and endDate required)
 */
export async function scrapeMeetupEvents(options: ScraperOptions): Promise<MeetupEvent[]> {
  logger.info('[Meetup] Starting Playwright scraper')
  return scrapeWithPlaywright(options)
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
  return domExtractionScript
}

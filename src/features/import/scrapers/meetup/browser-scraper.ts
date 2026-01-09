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
import { parseISO, eachDayOfInterval } from 'date-fns'
import type { MeetupEvent, MeetupGraphQLEvent } from './types'
import { extractRecurrencePattern, isRecurringEvent } from './date-parser'
import { BA_TIMEZONE } from '@/shared/lib/constants'
import { sanitizeError } from '@/shared/lib/security'

const MEETUP_BASE_URL = 'https://www.meetup.com/find/'

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

  const params = new URLSearchParams({
    customStartDate: formatWithOffset(startOfDay),
    customEndDate: formatWithOffset(endOfDay),
    source: 'EVENTS',
    eventType: 'inPerson',
    distance: 'tenMiles',
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
        city: gqlEvent.venue.city || 'Buenos Aires',
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

    // Add to main collection
    collectedEvents.push(...pageEvents)
  } finally {
    page.off('response', responseHandler)
  }
}

/**
 * Scrape events using local Playwright for a date range
 */
async function scrapeWithPlaywright(options: ScraperOptions): Promise<MeetupEvent[]> {
  const { chromium } = await import('playwright')

  const browser = await chromium.launch({
    headless: true,
  })

  const collectedEvents: MeetupEvent[] = []
  const seenIds = new Set<string>()

  try {
    const page = await browser.newPage()

    const dates = getDateRange(options.startDate, options.endDate)
    console.log(`[Meetup] Scraping ${dates.length} days from ${options.startDate} to ${options.endDate}`)

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i]
      const url = buildMeetupUrlForDate(date)
      const dateStr = date.toISOString().split('T')[0]

      console.log(`[Meetup] Scraping day ${i + 1}/${dates.length}: ${dateStr}`)

      await scrapePageForEvents(page, url, seenIds, collectedEvents)

      console.log(`[Meetup] Total events so far: ${collectedEvents.length}`)

      // Small delay between days to avoid rate limiting
      if (i < dates.length - 1) {
        await page.waitForTimeout(1000)
      }
    }

    console.log(`[Meetup] Finished scraping. Total events: ${collectedEvents.length}`)
    return collectedEvents
  } finally {
    await browser.close()
  }
}

/**
 * Scrape a single page using Puppeteer (Browserless)
 */
async function scrapeBrowserlessPage(
  page: Awaited<ReturnType<Awaited<typeof import('puppeteer-core')>['default']['connect']>>['newPage'] extends () => Promise<infer P> ? P : never,
  url: string,
  seenIds: Set<string>,
  collectedEvents: MeetupEvent[]
): Promise<void> {
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
      waitUntil: 'networkidle0',
      timeout: 60000,
    })

    // Wait and scroll
    await new Promise((r) => setTimeout(r, 3000))
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight))
      await new Promise((r) => setTimeout(r, 1500))
    }
    await new Promise((r) => setTimeout(r, 2000))

    // DOM fallback
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

    collectedEvents.push(...pageEvents)
  } finally {
    page.off('response', responseHandler)
  }
}

/**
 * Scrape events using Browserless (production/serverless mode) for a date range
 */
async function scrapeWithBrowserless(token: string, options: ScraperOptions): Promise<MeetupEvent[]> {
  const puppeteer = await import('puppeteer-core')

  let browser
  try {
    browser = await puppeteer.default.connect({
      browserWSEndpoint: `wss://chrome.browserless.io?token=${token}`,
    })
  } catch (error) {
    // Sanitize error to prevent token leakage in logs
    console.error('[Meetup] Failed to connect to Browserless:', sanitizeError(error))
    throw new Error('Failed to connect to browser service')
  }

  const collectedEvents: MeetupEvent[] = []
  const seenIds = new Set<string>()

  try {
    const page = await browser.newPage()

    const dates = getDateRange(options.startDate, options.endDate)
    console.log(`[Meetup] Scraping ${dates.length} days from ${options.startDate} to ${options.endDate}`)

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i]
      const url = buildMeetupUrlForDate(date)
      const dateStr = date.toISOString().split('T')[0]

      console.log(`[Meetup] Scraping day ${i + 1}/${dates.length}: ${dateStr}`)

      try {
        await scrapeBrowserlessPage(page, url, seenIds, collectedEvents)
      } catch (error) {
        // Sanitize error to prevent any sensitive data leakage
        console.error(`[Meetup] Error scraping page for ${dateStr}:`, sanitizeError(error))
        // Continue with next date rather than failing entirely
      }

      console.log(`[Meetup] Total events so far: ${collectedEvents.length}`)

      // Small delay between days
      if (i < dates.length - 1) {
        await new Promise((r) => setTimeout(r, 1000))
      }
    }

    console.log(`[Meetup] Finished scraping. Total events: ${collectedEvents.length}`)
    return collectedEvents
  } catch (error) {
    // Sanitize any error that might contain connection details
    console.error('[Meetup] Error during scraping:', sanitizeError(error))
    throw new Error('Scraping failed')
  } finally {
    await browser.close()
  }
}

/**
 * Main scraper function - automatically chooses the right method
 *
 * Uses Browserless if BROWSERLESS_TOKEN env var is set,
 * otherwise falls back to local Playwright.
 *
 * @param options - Date range to scrape (startDate and endDate required)
 */
export async function scrapeMeetupEvents(options: ScraperOptions): Promise<MeetupEvent[]> {
  const browserlessToken = process.env.BROWSERLESS_TOKEN

  if (browserlessToken) {
    console.log('[Meetup] Using Browserless for scraping')
    return scrapeWithBrowserless(browserlessToken, options)
  }

  console.log('[Meetup] Using local Playwright for scraping')
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

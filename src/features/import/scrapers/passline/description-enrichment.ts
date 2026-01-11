/**
 * Passline Description Enrichment (Server-side with Browser Automation)
 *
 * Fetches Passline event detail pages to extract descriptions from JSON-LD.
 *
 * Supports two modes:
 * - Browserless: Connects to Browserless.io (production/serverless) - bypasses Cloudflare
 * - Local: Uses Playwright with local Chromium (development fallback)
 *
 * This replaces the client-side extraction approach which was blocked by CORS.
 */

import type { Page, Browser } from 'playwright'
import type {
  PasslineDescriptionEnrichProgress,
  PasslineDescriptionEnrichComplete,
} from '@/shared/lib/streaming-types'
import { sanitizeError } from '@/shared/lib/security'
import {
  isCloudflareChallenge,
  BROWSER_USER_AGENT,
  BROWSER_VIEWPORT,
  STEALTH_LAUNCH_ARGS,
  DEFAULT_LOCALE,
  getBrowserlessEndpoint,
} from '@/shared/lib/browser'

export interface PasslineDescriptionResult {
  id: string
  eventName: string
  description: string | null
  error?: string
}

/**
 * Extract description from Passline event detail page HTML
 * Uses JSON-LD schema which contains the event description
 */
function extractDescriptionFromHtml(html: string): string | null {
  // Method 1: Extract from JSON-LD (most reliable)
  const jsonLdMatch = html.match(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i
  )

  if (jsonLdMatch) {
    try {
      const jsonLd = JSON.parse(jsonLdMatch[1])
      if (jsonLd.description && typeof jsonLd.description === 'string') {
        console.log(`[Passline Description] Extracted from JSON-LD: ${jsonLd.description.substring(0, 100)}...`)
        return jsonLd.description
      }
    } catch {
      console.log(`[Passline Description] Failed to parse JSON-LD`)
    }
  }

  // Method 2: Try meta description as fallback
  const metaMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i)
  if (metaMatch && metaMatch[1]) {
    console.log(`[Passline Description] Extracted from meta tag: ${metaMatch[1].substring(0, 100)}...`)
    return metaMatch[1]
  }

  console.log(`[Passline Description] No description found in HTML`)
  return null
}

/**
 * Ensure Passline URL is properly formed
 */
function getFullUrl(eventUrl: string): string {
  if (eventUrl.startsWith('http')) {
    return eventUrl
  }
  return `https://www.passline.com${eventUrl.startsWith('/') ? '' : '/'}${eventUrl}`
}

/**
 * Fetch description from a single Passline event detail page using Playwright
 */
export async function fetchPasslineDescriptionFromDetailPage(
  page: Page,
  eventUrl: string,
  eventName: string
): Promise<PasslineDescriptionResult> {
  const id = '' // Will be set by caller
  try {
    const fullUrl = getFullUrl(eventUrl)
    console.log(`[Passline Description] Navigating to ${fullUrl}`)

    await page.goto(fullUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    // Wait for content to load - check for JSON-LD script or main content
    try {
      await page.waitForSelector('script[type="application/ld+json"]', { timeout: 10000, state: 'attached' })
    } catch {
      // Check if this is a Cloudflare challenge page
      const html = await page.content()
      if (isCloudflareChallenge(html)) {
        console.log(`[Passline Description] Cloudflare challenge detected for "${eventName}", waiting...`)
        // Wait longer for Cloudflare to resolve
        await page.waitForTimeout(5000)
        try {
          await page.waitForSelector('script[type="application/ld+json"]', { timeout: 15000, state: 'attached' })
        } catch {
          console.log(`[Passline Description] Could not bypass Cloudflare for "${eventName}"`)
          return {
            id,
            eventName,
            description: null,
            error: 'Cloudflare challenge not resolved',
          }
        }
      } else {
        console.log(`[Passline Description] JSON-LD script not found for "${eventName}"`)
        // Continue anyway - might have meta description
      }
    }

    // Get page HTML after waiting for content
    const html = await page.content()

    // Double-check we're not on a Cloudflare page
    if (isCloudflareChallenge(html) && !html.includes('application/ld+json')) {
      console.log(`[Passline Description] Still on Cloudflare page for "${eventName}"`)
      return {
        id,
        eventName,
        description: null,
        error: 'Cloudflare challenge page',
      }
    }

    const description = extractDescriptionFromHtml(html)

    if (description) {
      console.log(`[Passline Description] Found description for "${eventName}": ${description.substring(0, 50)}...`)
    } else {
      console.log(`[Passline Description] No description found for "${eventName}"`)
    }

    return {
      id,
      eventName,
      description,
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    console.log(`[Passline Description] Failed to fetch from ${eventUrl}:`, errorMsg)
    return {
      id,
      eventName,
      description: null,
      error: errorMsg,
    }
  }
}

export interface EventDescriptionInput {
  id: string
  name: string
  link: string
}

/**
 * Fetch description from a single Passline page using Browserless.io
 */
async function fetchWithBrowserless(
  token: string,
  event: EventDescriptionInput
): Promise<PasslineDescriptionResult> {
  const puppeteer = await import('puppeteer-core')

  let browser
  try {
    // Use stealth mode and block ads to appear more like a real browser
    browser = await puppeteer.default.connect({
      browserWSEndpoint: getBrowserlessEndpoint(token),
    })
  } catch (error) {
    console.error('[Passline Description] Failed to connect to Browserless:', sanitizeError(error))
    throw new Error('Failed to connect to browser service')
  }

  try {
    const page = await browser.newPage()
    const fullUrl = getFullUrl(event.link)

    console.log(`[Passline Description] Navigating to ${fullUrl}`)

    await page.goto(fullUrl, {
      waitUntil: 'networkidle0',
      timeout: 45000,
    })

    // Wait for JSON-LD script, with retry for Cloudflare challenge
    let attempts = 0
    const maxAttempts = 3

    while (attempts < maxAttempts) {
      try {
        await page.waitForSelector('script[type="application/ld+json"]', { timeout: 15000 })
        break // Success!
      } catch {
        attempts++
        const html = await page.content()
        const cloudflareDetected = isCloudflareChallenge(html)

        if (cloudflareDetected && attempts < maxAttempts) {
          console.log(`[Passline Description] Cloudflare challenge for "${event.name}", waiting (attempt ${attempts}/${maxAttempts})...`)
          // Wait for Turnstile to potentially auto-resolve
          await new Promise(resolve => setTimeout(resolve, 8000))
          continue
        }

        // Continue to try extracting anyway - might have meta description
        break
      }
    }

    const html = await page.content()

    // Check if we're still on Cloudflare
    if (isCloudflareChallenge(html) && !html.includes('application/ld+json')) {
      const pageTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || 'unknown'
      console.log(`[Passline Description] Cloudflare page for "${event.name}", title: "${pageTitle}"`)
      return {
        id: event.id,
        eventName: event.name,
        description: null,
        error: 'Cloudflare challenge',
      }
    }

    const description = extractDescriptionFromHtml(html)

    if (description) {
      console.log(`[Passline Description] Found description for "${event.name}": ${description.substring(0, 50)}...`)
    } else {
      console.log(`[Passline Description] No description found for "${event.name}"`)
    }

    return {
      id: event.id,
      eventName: event.name,
      description,
    }
  } catch (error) {
    console.error('[Passline Description] Error during scraping:', sanitizeError(error))
    return {
      id: event.id,
      eventName: event.name,
      description: null,
      error: 'Scraping failed',
    }
  } finally {
    await browser.close()
  }
}

/**
 * Batch fetch descriptions using Browserless.io (production/serverless)
 */
async function* fetchWithBrowserlessBatch(
  token: string,
  events: EventDescriptionInput[],
  delayMs: number
): AsyncGenerator<PasslineDescriptionEnrichProgress | PasslineDescriptionEnrichComplete> {
  const results: PasslineDescriptionResult[] = []
  let enriched = 0
  let translated = 0 // Will be set by caller after translation

  console.log(`[Passline Description] Starting Browserless batch for ${events.length} events...`)

  for (let i = 0; i < events.length; i++) {
    const event = events[i]

    const result = await fetchWithBrowserless(token, event)
    results.push(result)

    if (result.description) {
      enriched++
    }

    yield {
      type: 'progress',
      current: i + 1,
      total: events.length,
      eventName: result.eventName,
      success: !!result.description,
    }

    // Delay between requests (except after last one)
    if (i < events.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    console.log(`[Passline Description] Progress: ${i + 1}/${events.length}`)
  }

  console.log(
    `[Passline Description] Completed. Found descriptions for ${enriched}/${events.length} events`
  )

  yield {
    type: 'complete',
    enriched,
    translated,
    total: events.length,
  }
}

/**
 * Batch fetch descriptions using local Playwright (development fallback)
 */
async function* fetchWithPlaywrightBatch(
  events: EventDescriptionInput[],
  delayMs: number
): AsyncGenerator<PasslineDescriptionEnrichProgress | PasslineDescriptionEnrichComplete> {
  const { chromium } = await import('playwright')

  // Launch browser with settings to appear more like a real browser
  const browser: Browser = await chromium.launch({
    headless: true,
    args: [...STEALTH_LAUNCH_ARGS],
  })

  const results: PasslineDescriptionResult[] = []
  let enriched = 0
  let translated = 0 // Will be set by caller after translation

  try {
    console.log(`[Passline Description] Starting Playwright batch for ${events.length} events...`)

    for (let i = 0; i < events.length; i++) {
      const event = events[i]

      const context = await browser.newContext({
        userAgent: BROWSER_USER_AGENT,
        viewport: BROWSER_VIEWPORT,
        locale: DEFAULT_LOCALE,
      })
      const page = await context.newPage()

      try {
        const result = await fetchPasslineDescriptionFromDetailPage(page, event.link, event.name)
        result.id = event.id
        results.push(result)

        if (result.description) {
          enriched++
        }

        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName: result.eventName,
          success: !!result.description,
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        results.push({
          id: event.id,
          eventName: event.name,
          description: null,
          error: errorMsg,
        })

        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName: event.name,
          success: false,
        }
      } finally {
        await page.close()
        await context.close()
      }

      // Delay between requests (except after last one)
      if (i < events.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }

      console.log(`[Passline Description] Progress: ${i + 1}/${events.length}`)
    }

    console.log(
      `[Passline Description] Completed. Found descriptions for ${enriched}/${events.length} events`
    )

    yield {
      type: 'complete',
      enriched,
      translated,
      total: events.length,
    }
  } finally {
    await browser.close()
  }
}

/**
 * Batch fetch descriptions for multiple Passline events with streaming progress
 *
 * Automatically chooses the right method:
 * - Browserless.io if BROWSERLESS_TOKEN env var is set (production)
 * - Local Playwright otherwise (development fallback)
 *
 * @param events - Array of events with id, name, and link
 * @param delayMs - Delay between requests in milliseconds (default: 2000)
 */
export async function* fetchPasslineDescriptionsBatch(
  events: EventDescriptionInput[],
  delayMs: number = 2000
): AsyncGenerator<PasslineDescriptionEnrichProgress | PasslineDescriptionEnrichComplete> {
  if (events.length === 0) {
    yield {
      type: 'complete',
      enriched: 0,
      translated: 0,
      total: 0,
    }
    return
  }

  const browserlessToken = process.env.BROWSERLESS_TOKEN

  if (browserlessToken) {
    console.log('[Passline Description] Using Browserless for description fetching')
    yield* fetchWithBrowserlessBatch(browserlessToken, events, delayMs)
    return
  }

  console.log('[Passline Description] Using local Playwright for description fetching (may fail due to Cloudflare)')
  yield* fetchWithPlaywrightBatch(events, delayMs)
}

/**
 * Fetch a single description - convenience wrapper
 * Used for testing or single-event enrichment
 */
export async function fetchPasslineDescription(
  event: EventDescriptionInput
): Promise<PasslineDescriptionResult> {
  const browserlessToken = process.env.BROWSERLESS_TOKEN

  if (browserlessToken) {
    return fetchWithBrowserless(browserlessToken, event)
  }

  // Local Playwright fallback
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    headless: true,
    args: [...STEALTH_LAUNCH_ARGS],
  })

  try {
    const context = await browser.newContext({
      userAgent: BROWSER_USER_AGENT,
      viewport: BROWSER_VIEWPORT,
      locale: DEFAULT_LOCALE,
    })
    const page = await context.newPage()

    const result = await fetchPasslineDescriptionFromDetailPage(page, event.link, event.name)
    result.id = event.id
    return result
  } finally {
    await browser.close()
  }
}

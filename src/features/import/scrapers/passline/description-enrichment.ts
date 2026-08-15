/**
 * Passline Description Enrichment (Server-side with Browser Automation)
 *
 * Fetches Passline event detail pages to extract descriptions from JSON-LD.
 *
 * Uses local Playwright with Chromium to fetch pages.
 *
 * This replaces the client-side extraction approach which was blocked by CORS.
 */

import type { Page, Browser } from 'playwright'
import type {
  PasslineDescriptionEnrichProgress,
  PasslineDescriptionEnrichComplete,
} from '#shared/lib/streaming-types.ts'
import {
  isCloudflareChallenge,
  BROWSER_USER_AGENT,
  BROWSER_VIEWPORT,
  STEALTH_LAUNCH_ARGS,
  DEFAULT_LOCALE,
} from '#shared/lib/browser/index.ts'

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
 * Batch fetch descriptions using local Playwright
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

  console.log('[Passline Description] Using local Playwright for description fetching')
  yield* fetchWithPlaywrightBatch(events, delayMs)
}

/**
 * Fetch a single description - convenience wrapper
 * Used for testing or single-event enrichment
 */
export async function fetchPasslineDescription(
  event: EventDescriptionInput
): Promise<PasslineDescriptionResult> {
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

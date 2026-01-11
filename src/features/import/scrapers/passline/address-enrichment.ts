/**
 * Passline Address Enrichment (Server-side with Browser Automation)
 *
 * Fetches Passline event detail pages to extract venue addresses.
 *
 * Supports two modes:
 * - Browserless: Connects to Browserless.io (production/serverless) - bypasses Cloudflare
 * - Local: Uses Playwright with local Chromium (development fallback)
 *
 * The address is used for more accurate Nominatim neighborhood lookup.
 */

import type { Page, Browser } from 'playwright'
import type {
  PasslineAddressProgress,
  PasslineAddressComplete,
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

export interface PasslineAddressResult {
  venueName: string
  address: string | null
  location: string | null // City/region like "Buenos Aires, PALERMO"
  error?: string
}

/**
 * Check if two strings match (case-insensitive)
 */
function matchesVenueName(line: string, venueName: string): boolean {
  return line.toLowerCase().trim() === venueName.toLowerCase().trim()
}

/**
 * Check if a line looks like a street address
 * Only uses generic patterns - relies on HTML structure for context
 */
function isAddressLine(line: string): boolean {
  // Must be > 3 chars to avoid matching things like "1ro"
  if (line.length <= 3) return false

  // Has street number (digits)
  if (/\d+/.test(line)) return true

  return false
}

/**
 * Extract address from Passline event detail page HTML
 * Passline venue blocks are in: <div id="segundo_contenedor" class="donde">
 */
function extractAddressFromHtml(html: string, venueName: string): PasslineAddressResult {
  let address: string | null = null
  let location: string | null = null

  // Method 1: Target the specific venue container div (most reliable)
  // <div id="segundo_contenedor" class="donde ...">
  const venueContainerMatch = html.match(
    /<div[^>]*id="segundo_contenedor"[^>]*class="[^"]*donde[^"]*"[^>]*>([\s\S]*?)<\/div>/i
  )

  if (venueContainerMatch) {
    const containerHtml = venueContainerMatch[1]
    console.log(`[Passline Extract] Found segundo_contenedor for "${venueName}"`)

    // Strip HTML tags and get text lines
    const lines = containerHtml
      .replace(/<[^>]+>/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    console.log(`[Passline Extract] Lines found:`, lines)

    // Find address line (has numbers or street keywords)
    for (const line of lines) {
      // Skip if this is the venue name
      if (matchesVenueName(line, venueName)) continue

      if (!address && isAddressLine(line)) {
        address = line
        console.log(`[Passline Extract] Found address: "${address}"`)
      }

      // Find location line (City, REGION format like "Capital Federal, C.A.B.A.")
      // Skip if this line was already identified as the address
      if (!location && line !== address && line.includes(',')) {
        // Check for patterns like "Capital Federal, C.A.B.A." or "Buenos Aires, PALERMO"
        if (/(?:capital federal|buenos aires|c\.?a\.?b\.?a)/i.test(line) ||
            /[A-ZÁÉÍÓÚ]{2,}$/.test(line.trim())) {
          location = line
          console.log(`[Passline Extract] Found location: "${location}"`)
        }
      }
    }
  }

  // Method 2: Look for venue name in HTML and extract surrounding text (fallback)
  if (!address && venueName) {
    const venueNameEscaped = venueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const venueBlockPattern = new RegExp(venueNameEscaped + '[\\s\\S]{0,300}', 'i')
    const venueBlockMatch = html.match(venueBlockPattern)

    if (venueBlockMatch) {
      console.log(`[Passline Extract] Using venue name pattern fallback for "${venueName}"`)
      const blockText = venueBlockMatch[0]
        .replace(/<[^>]+>/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      for (const line of blockText) {
        if (matchesVenueName(line, venueName)) continue
        if (!address && isAddressLine(line)) {
          address = line
        }
        if (!location && line.includes(',') && /[A-ZÁÉÍÓÚ]{2,}$/.test(line.trim())) {
          location = line
        }
      }
    }
  }

  // Method 3: Try to find venue block near maps link if present
  if (!address) {
    const mapsLinkMatch = html.match(
      /href="[^"]*(?:maps\.app\.goo\.gl|google\.com\/maps|javascript:void)[^"]*"[^>]*>([\s\S]*?)<\/a>/i
    )

    if (mapsLinkMatch) {
      console.log(`[Passline Extract] Using maps link fallback for "${venueName}"`)
      const linkContent = mapsLinkMatch[1]
        .replace(/<[^>]+>/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      for (const line of linkContent) {
        if (!address && isAddressLine(line)) {
          address = line
        }
        if (!location && line.includes(',') && /[A-ZÁÉÍÓÚ]{2,}$/.test(line.trim())) {
          location = line
        }
      }
    }
  }

  // Method 4: Extract location from broader HTML patterns
  if (!location) {
    const locationPatterns = [
      // Pattern: "Buenos Aires, NEIGHBORHOOD"
      />\s*(Buenos\s+Aires,\s*[A-ZÁÉÍÓÚ][A-Za-záéíóúñÁÉÍÓÚÑ\s]+)\s*</i,
      // Pattern: "Capital Federal, NEIGHBORHOOD" or "Capital Federal, C.A.B.A."
      />\s*(Capital\s+Federal,\s*[A-Za-záéíóúñÁÉÍÓÚÑ\s.]+)\s*</i,
      // Pattern: "CityName, REGION" (all caps region)
      />\s*([A-Za-záéíóúñÁÉÍÓÚÑ\s]+,\s*[A-ZÁÉÍÓÚ]{2,})\s*</,
    ]

    for (const pattern of locationPatterns) {
      const match = html.match(pattern)
      if (match) {
        location = match[1].trim()
        break
      }
    }
  }

  return {
    venueName,
    address,
    location,
  }
}

/**
 * Fetch address from a single Passline event detail page
 */
export async function fetchPasslineAddressFromDetailPage(
  page: Page,
  eventUrl: string,
  venueName: string
): Promise<PasslineAddressResult> {
  try {
    // Ensure URL is properly formed
    let fullUrl = eventUrl
    if (!fullUrl.startsWith('http')) {
      fullUrl = `https://www.passline.com${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}`
    }

    console.log(`[Passline Address] Navigating to ${fullUrl}`)

    await page.goto(fullUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    // Wait for the venue container to appear (indicates real page loaded, not Cloudflare challenge)
    try {
      await page.waitForSelector('#segundo_contenedor', { timeout: 10000, state: 'attached' })
    } catch {
      // Check if this is a Cloudflare challenge page
      const html = await page.content()
      if (isCloudflareChallenge(html)) {
        console.log(`[Passline Address] Cloudflare challenge detected for "${venueName}", waiting...`)
        // Wait longer for Cloudflare to resolve
        await page.waitForTimeout(5000)
        try {
          await page.waitForSelector('#segundo_contenedor', { timeout: 15000, state: 'attached' })
        } catch {
          console.log(`[Passline Address] Could not bypass Cloudflare for "${venueName}"`)
          return {
            venueName,
            address: null,
            location: null,
            error: 'Cloudflare challenge not resolved',
          }
        }
      } else {
        console.log(`[Passline Address] Venue container not found for "${venueName}"`)
        return {
          venueName,
          address: null,
          location: null,
          error: 'Venue container not found',
        }
      }
    }

    // Get page HTML after waiting for content
    const html = await page.content()

    // Double-check we're not on a Cloudflare page
    if (isCloudflareChallenge(html) && !html.includes('segundo_contenedor')) {
      console.log(`[Passline Address] Still on Cloudflare page for "${venueName}"`)
      return {
        venueName,
        address: null,
        location: null,
        error: 'Cloudflare challenge page',
      }
    }

    const result = extractAddressFromHtml(html, venueName)

    if (result.address) {
      console.log(`[Passline Address] Found address for "${venueName}": ${result.address}`)
    } else {
      console.log(`[Passline Address] No address found for "${venueName}"`)
    }

    return result
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    console.log(`[Passline Address] Failed to fetch from ${eventUrl}:`, errorMsg)
    return {
      venueName,
      address: null,
      location: null,
      error: errorMsg,
    }
  }
}

export interface VenueAddressInput {
  venueName: string
  eventUrl: string
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
 * Fetch address from a single Passline page using Browserless.io
 */
async function fetchWithBrowserless(
  token: string,
  eventUrl: string,
  venueName: string
): Promise<PasslineAddressResult> {
  const puppeteer = await import('puppeteer-core')

  let browser
  try {
    // Use stealth mode and block ads to appear more like a real browser
    browser = await puppeteer.default.connect({
      browserWSEndpoint: getBrowserlessEndpoint(token),
    })
  } catch (error) {
    console.error('[Passline Address] Failed to connect to Browserless:', sanitizeError(error))
    throw new Error('Failed to connect to browser service')
  }

  try {
    const page = await browser.newPage()
    const fullUrl = getFullUrl(eventUrl)

    console.log(`[Passline Address] Navigating to ${fullUrl}`)

    await page.goto(fullUrl, {
      waitUntil: 'networkidle0',
      timeout: 45000,
    })

    // Wait for venue container, with retry for Cloudflare challenge
    let attempts = 0
    const maxAttempts = 3

    while (attempts < maxAttempts) {
      try {
        await page.waitForSelector('#segundo_contenedor', { timeout: 15000 })
        break // Success!
      } catch {
        attempts++
        const html = await page.content()
        const cloudflareDetected = isCloudflareChallenge(html)

        if (cloudflareDetected && attempts < maxAttempts) {
          console.log(`[Passline Address] Cloudflare challenge for "${venueName}", waiting (attempt ${attempts}/${maxAttempts})...`)
          // Wait for Turnstile to potentially auto-resolve
          await new Promise(resolve => setTimeout(resolve, 8000))
          continue
        }

        // Final failure
        const pageTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || 'unknown'
        console.log(`[Passline Address] Venue container not found for "${venueName}"`)
        console.log(`[Passline Address] Page title: "${pageTitle}", Cloudflare: ${cloudflareDetected}, HTML length: ${html.length}`)

        return {
          venueName,
          address: null,
          location: null,
          error: cloudflareDetected ? 'Cloudflare challenge' : 'Venue container not found',
        }
      }
    }

    const html = await page.content()
    const result = extractAddressFromHtml(html, venueName)

    if (result.address) {
      console.log(`[Passline Address] Found address for "${venueName}": ${result.address}`)
    } else {
      console.log(`[Passline Address] No address found for "${venueName}"`)
    }

    return result
  } catch (error) {
    console.error('[Passline Address] Error during scraping:', sanitizeError(error))
    return {
      venueName,
      address: null,
      location: null,
      error: 'Scraping failed',
    }
  } finally {
    await browser.close()
  }
}

/**
 * Batch fetch addresses using Browserless.io (production/serverless)
 */
async function* fetchWithBrowserlessBatch(
  token: string,
  venues: VenueAddressInput[],
  delayMs: number
): AsyncGenerator<PasslineAddressProgress | PasslineAddressComplete> {
  const results: PasslineAddressResult[] = []

  console.log(`[Passline Address] Starting Browserless batch for ${venues.length} venues...`)

  for (let i = 0; i < venues.length; i++) {
    const venue = venues[i]

    const result = await fetchWithBrowserless(token, venue.eventUrl, venue.venueName)
    results.push(result)

    yield {
      type: 'progress',
      current: i + 1,
      total: venues.length,
      venueName: result.venueName,
      address: result.address,
      location: result.location,
      success: !!result.address,
      error: result.error ?? null,
    }

    // Delay between requests (except after last one)
    if (i < venues.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    console.log(`[Passline Address] Progress: ${i + 1}/${venues.length}`)
  }

  const successCount = results.filter((r) => r.address).length
  console.log(
    `[Passline Address] Completed. Found addresses for ${successCount}/${venues.length} venues`
  )

  yield {
    type: 'complete',
    results,
  }
}

/**
 * Batch fetch addresses using local Playwright (development fallback)
 *
 * Uses a single browser instance and processes events sequentially to avoid
 * triggering Cloudflare's bot detection.
 *
 * Note: This will likely fail due to Cloudflare. Use Browserless in production.
 */
async function* fetchWithPlaywrightBatch(
  venues: VenueAddressInput[],
  concurrency: number,
  delayMs: number
): AsyncGenerator<PasslineAddressProgress | PasslineAddressComplete> {
  const { chromium } = await import('playwright')

  // Launch browser with settings to appear more like a real browser
  const browser: Browser = await chromium.launch({
    headless: true,
    args: [...STEALTH_LAUNCH_ARGS],
  })

  const results: PasslineAddressResult[] = []

  try {
    console.log(`[Passline Address] Starting Playwright batch for ${venues.length} venues...`)

    // Process in batches
    for (let i = 0; i < venues.length; i += concurrency) {
      const batch = venues.slice(i, i + concurrency)

      // Process batch (sequentially by default to avoid Cloudflare)
      const batchResults = await Promise.all(
        batch.map(async (venue) => {
          const context = await browser.newContext({
            userAgent: BROWSER_USER_AGENT,
            viewport: BROWSER_VIEWPORT,
            locale: DEFAULT_LOCALE,
          })
          const page = await context.newPage()
          try {
            const result = await fetchPasslineAddressFromDetailPage(
              page,
              venue.eventUrl,
              venue.venueName
            )
            return result
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error'
            return {
              venueName: venue.venueName,
              address: null,
              location: null,
              error: errorMsg,
            }
          } finally {
            await page.close()
            await context.close()
          }
        })
      )

      // Track results
      for (const result of batchResults) {
        results.push(result)

        // Yield progress for each venue
        yield {
          type: 'progress',
          current: results.length,
          total: venues.length,
          venueName: result.venueName,
          address: result.address,
          location: result.location,
          success: !!result.address,
          error: result.error ?? null,
        }
      }

      // Delay between batches (except after last batch)
      if (i + concurrency < venues.length) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }

      console.log(
        `[Passline Address] Progress: ${Math.min(i + concurrency, venues.length)}/${venues.length}`
      )
    }

    // Final completion message
    const successCount = results.filter((r) => r.address).length
    console.log(
      `[Passline Address] Completed. Found addresses for ${successCount}/${venues.length} venues`
    )

    yield {
      type: 'complete',
      results,
    }
  } finally {
    await browser.close()
  }
}

/**
 * Batch fetch addresses for multiple Passline venues with streaming progress
 *
 * Automatically chooses the right method:
 * - Browserless.io if BROWSERLESS_TOKEN env var is set (production)
 * - Local Playwright otherwise (development fallback)
 *
 * @param venues - Array of venues with name and event URL
 * @param concurrency - Number of pages to process in parallel (default: 1)
 * @param delayMs - Delay between requests in milliseconds (default: 2000)
 */
export async function* fetchPasslineAddressesBatch(
  venues: VenueAddressInput[],
  concurrency: number = 1,
  delayMs: number = 2000
): AsyncGenerator<PasslineAddressProgress | PasslineAddressComplete> {
  if (venues.length === 0) {
    yield {
      type: 'complete',
      results: [],
    }
    return
  }

  const browserlessToken = process.env.BROWSERLESS_TOKEN

  if (browserlessToken) {
    console.log('[Passline Address] Using Browserless for address fetching')
    yield* fetchWithBrowserlessBatch(browserlessToken, venues, delayMs)
    return
  }

  console.log('[Passline Address] Using local Playwright for address fetching (may fail due to Cloudflare)')
  yield* fetchWithPlaywrightBatch(venues, concurrency, delayMs)
}

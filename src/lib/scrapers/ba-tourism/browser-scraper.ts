/**
 * BA Tourism Browser Scraper
 *
 * Uses Playwright to scrape events from the BA Tourism website.
 * The website loads content dynamically via JavaScript, so we need
 * a real browser to execute the page scripts.
 *
 * Supports two modes:
 * - Local: Uses Playwright with local Chromium (development)
 * - Browserless: Connects to Browserless.io (production/serverless)
 */

import type { BATourismEvent, WeekContext } from './types'
import { parseWeekContext } from './date-parser'

const BA_TOURISM_URL = 'https://turismo.buenosaires.gob.ar/es/article/que-hacer-esta-semana'

/**
 * Extraction script to run in the browser context
 * Returns events and week context text
 */
const extractionScript = () => {
  const events: Array<{
    name: string
    category: string
    isFree: boolean
    whenText: string
    venueName: string
    neighborhood: string
    address: string | null
    coordinates: { lat: number; lng: number } | null
    description: string
    moreInfoUrl: string
  }> = []

  const cards = document.querySelectorAll('.card-landing')

  const skipNames = [
    'para disfrutar',
    'visitas, paseos',
    'imperdibles',
    'turismo en barrios',
    'destacar en el listado',
  ]

  const parseCategoryHeading = (text: string) => {
    const cleaned = text.replace(/\[/g, '').replace(/\]/g, '').trim()
    const parts = cleaned.split('|').map((p) => p.trim())
    return {
      category: parts[0] || 'Evento',
      isFree: (parts[1] || '-').toLowerCase() === 'gratis',
    }
  }

  const parseVenueText = (text: string) => {
    const lastCommaIdx = text.lastIndexOf(',')
    if (lastCommaIdx > 0) {
      const neighborhood = text.slice(lastCommaIdx + 1).trim()
      const beforeNeighborhood = text.slice(0, lastCommaIdx).trim()
      const doubleSpaceIdx = beforeNeighborhood.indexOf('  ')
      if (doubleSpaceIdx > 0) {
        return {
          venueName: beforeNeighborhood.slice(0, doubleSpaceIdx).trim(),
          neighborhood,
        }
      }
      return { venueName: beforeNeighborhood, neighborhood }
    }
    return { venueName: text.trim(), neighborhood: 'CABA' }
  }

  const extractCoordinates = (url: string | null) => {
    if (!url) return null
    const match = url.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    if (match) {
      return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) }
    }
    return null
  }

  cards.forEach((card) => {
    const name = card.querySelector('h2')?.textContent?.trim() || ''
    if (!name) return
    if (skipNames.some((skip) => name.toLowerCase().includes(skip))) return

    const categoryText = card.querySelector('.media-heading')?.textContent?.trim() || ''
    const { category, isFree } = parseCategoryHeading(categoryText)

    let whenText = ''
    let dondeText = ''
    const paragraphs = card.querySelectorAll('p')
    for (let i = 0; i < paragraphs.length; i++) {
      const text = paragraphs[i].textContent?.trim() || ''
      // Use includes() for flexible matching - handles encoding/whitespace issues
      const textLower = text.toLowerCase()
      if (textLower.includes('cuándo') && paragraphs[i + 1]) {
        whenText = paragraphs[i + 1].textContent?.trim() || ''
      }
      if (textLower.includes('dónde') && paragraphs[i + 1]) {
        dondeText = paragraphs[i + 1].textContent?.trim() || ''
      }
    }

    const { venueName, neighborhood } = parseVenueText(dondeText)

    const mapsLink = card.querySelector('a[href*="google.com/maps"]') as HTMLAnchorElement | null
    const address = mapsLink?.textContent?.trim() || null
    const mapsHref = mapsLink?.getAttribute('href') || null
    const coordinates = extractCoordinates(mapsHref)

    let moreInfoUrl = ''
    const links = card.querySelectorAll('a')
    for (const link of links) {
      if (link.textContent?.toLowerCase().includes('más información')) {
        moreInfoUrl = (link as HTMLAnchorElement).href || ''
        break
      }
    }

    let description = ''
    let foundDonde = false
    for (const p of paragraphs) {
      const text = p.textContent?.trim() || ''
      if (text.toLowerCase().includes('dónde')) {
        foundDonde = true
        continue
      }
      if (
        foundDonde &&
        text.length > 50 &&
        !text.toLowerCase().includes('más información') &&
        text !== dondeText &&
        !description
      ) {
        description = text
      }
    }

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

  // Get week context
  let weekContextText = ''
  const allP = document.querySelectorAll('.field-name-body p, article p')
  for (const p of allP) {
    const text = p.textContent?.trim() || ''
    if (text.toLowerCase().includes('desde el lunes') && text.toLowerCase().includes('al domingo')) {
      weekContextText = text
      break
    }
  }

  return { events, weekContextText }
}

/**
 * Scrape events using local Playwright (development mode)
 */
async function scrapeWithPlaywright(): Promise<{
  events: BATourismEvent[]
  weekContext: WeekContext
}> {
  const { chromium } = await import('playwright')

  const browser = await chromium.launch({
    headless: true,
  })

  try {
    const page = await browser.newPage()

    console.log('[BA Tourism] Navigating to page...')
    await page.goto(BA_TOURISM_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    })

    // Wait for event cards with actual content (h2 inside card-landing)
    // This ensures the dynamic content has been rendered
    console.log('[BA Tourism] Waiting for cards to load...')
    await page.waitForSelector('.card-landing h2', { timeout: 60000, state: 'attached' })

    // Wait for multiple cards to appear (site loads ~28 events)
    // Poll until we have at least 10 cards or timeout after 30 seconds
    console.log('[BA Tourism] Waiting for all cards to render...')
    await page.waitForFunction(
      () => document.querySelectorAll('.card-landing').length >= 10,
      { timeout: 30000 }
    ).catch(() => {
      console.log('[BA Tourism] Timeout waiting for 10+ cards, proceeding with available cards')
    })

    // Additional delay to ensure all content is rendered
    await page.waitForTimeout(3000)

    // Debug: Count cards before extraction
    const cardCount = await page.evaluate(() => document.querySelectorAll('.card-landing').length)
    console.log(`[BA Tourism] Found ${cardCount} cards on page`)

    // Execute extraction script in browser context
    console.log('[BA Tourism] Running extraction script...')
    const result = await page.evaluate(extractionScript)
    console.log(`[BA Tourism] Extracted ${result.events.length} events`)

    const weekContext = parseWeekContext(result.weekContextText)

    return {
      events: result.events as BATourismEvent[],
      weekContext,
    }
  } finally {
    await browser.close()
  }
}

/**
 * Scrape events using Browserless (production/serverless mode)
 */
async function scrapeWithBrowserless(token: string): Promise<{
  events: BATourismEvent[]
  weekContext: WeekContext
}> {
  const puppeteer = await import('puppeteer-core')

  const browser = await puppeteer.default.connect({
    browserWSEndpoint: `wss://chrome.browserless.io?token=${token}`,
  })

  try {
    const page = await browser.newPage()

    await page.goto(BA_TOURISM_URL, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    })

    // Wait for event cards to load
    await page.waitForSelector('.card-landing', { timeout: 10000 })

    // Execute extraction script in browser context
    const result = await page.evaluate(extractionScript)

    const weekContext = parseWeekContext(result.weekContextText)

    return {
      events: result.events as BATourismEvent[],
      weekContext,
    }
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
export async function scrapeBATourismEventsWithBrowser(): Promise<{
  events: BATourismEvent[]
  weekContext: WeekContext
}> {
  const browserlessToken = process.env.BROWSERLESS_TOKEN

  if (browserlessToken) {
    console.log('[BA Tourism] Using Browserless for scraping')
    return scrapeWithBrowserless(browserlessToken)
  }

  console.log('[BA Tourism] Using local Playwright for scraping')
  return scrapeWithPlaywright()
}

/**
 * Eventbrite Event Enrichment
 *
 * Enriches Eventbrite events with:
 * 1. Price (fetched from individual event pages)
 * 2. Categories + Vibes (inferred via AI from name + description)
 *
 * This runs as Phase 2, after the fast JSON-LD import.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { Category, Vibe } from '@/lib/types'

const anthropic = new Anthropic()

// ---------------------------------------------------------------------------
// Price Extraction
// ---------------------------------------------------------------------------

export interface EventbritePriceInfo {
  price: number | null
  isFree: boolean
}

/**
 * Fetch an Eventbrite event page and extract price information
 */
export async function fetchEventbritePrice(url: string): Promise<EventbritePriceInfo | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
      },
    })

    if (!response.ok) {
      console.error(`[eventbrite] Price fetch failed for ${url}: ${response.status}`)
      return null
    }

    const html = await response.text()
    return extractPriceFromHtml(html)
  } catch (error) {
    console.error(`[eventbrite] Price fetch error for ${url}:`, error)
    return null
  }
}

/**
 * Extract price from Eventbrite page HTML
 */
function extractPriceFromHtml(html: string): EventbritePriceInfo {
  // Check for "Gratis" or "Free" indicators first
  if (
    html.includes('>Gratis<') ||
    html.includes('>Free<') ||
    html.includes('data-testid="free-badge"') ||
    html.includes('"price":"0"') ||
    html.includes('"price": "0"')
  ) {
    return { price: 0, isFree: true }
  }

  // Try to find price in various formats
  // Format 1: $X.XXX,XX ARS or $X,XXX.XX USD
  const arsMatch = html.match(/\$\s*([\d.]+)[,.](\d{2})\s*(ARS)?/i)
  if (arsMatch) {
    // Argentine format: 1.500,00 → 1500.00
    const intPart = arsMatch[1].replace(/\./g, '')
    const decPart = arsMatch[2]
    const price = parseFloat(`${intPart}.${decPart}`)
    if (!isNaN(price)) {
      return { price, isFree: price === 0 }
    }
  }

  // Format 2: Simple number with optional decimals
  const simpleMatch = html.match(/(?:desde|from)?\s*\$\s*([\d,]+(?:\.\d{2})?)/i)
  if (simpleMatch) {
    const price = parseFloat(simpleMatch[1].replace(/,/g, ''))
    if (!isNaN(price)) {
      return { price, isFree: price === 0 }
    }
  }

  // Format 3: JSON-LD offers.price on individual page
  const jsonLdPriceMatch = html.match(/"price"\s*:\s*"?([\d.]+)"?/)
  if (jsonLdPriceMatch) {
    const price = parseFloat(jsonLdPriceMatch[1])
    if (!isNaN(price)) {
      return { price, isFree: price === 0 }
    }
  }

  // No price found - assume free (common for many Eventbrite events)
  return { price: null, isFree: true }
}

// ---------------------------------------------------------------------------
// AI-based Category & Vibe Inference
// ---------------------------------------------------------------------------

// Valid categories and vibes for the AI to choose from
const VALID_CATEGORIES: readonly string[] = [
  'techno',
  'house',
  'electronic',
  'jazz',
  'rock',
  'indie',
  'latin',
  'tango',
  'classical',
  'hip-hop',
  'reggaeton',
  'folk',
  'art',
  'theatre',
  'comedy',
  'film',
  'food',
  'market',
  'festival',
  'workshop',
  'networking',
  'sports',
  'other',
]

const VALID_VIBES: readonly string[] = [
  'underground',
  'mainstream',
  'chill',
  'high-energy',
  'romantic',
  'family-friendly',
  'lgbtq-friendly',
  'expat-friendly',
  'local',
  'touristy',
  'intimate',
  'massive',
  'outdoor',
  'rooftop',
]

/**
 * Prompt for Haiku to infer categories and vibes
 */
const INFERENCE_PROMPT = `Analyze this event and determine its categories and vibes.

VALID CATEGORIES (choose 1-3):
${VALID_CATEGORIES.join(', ')}

VALID VIBES (choose 1-4):
${VALID_VIBES.join(', ')}

Based on the event name and description, identify:
1. The most relevant categories (music genre, event type, etc.)
2. The atmosphere/vibe of the event

Respond in JSON format ONLY:
{"categories": ["category1", "category2"], "vibes": ["vibe1", "vibe2"]}

Only use values from the valid lists above. If unsure, use "other" for category.`

export interface CategoryVibeInference {
  categories: Category[]
  vibes: Vibe[]
}

/**
 * Infer categories and vibes from event name and description using AI
 */
export async function inferCategoriesAndVibes(
  name: string,
  description: string | null
): Promise<CategoryVibeInference> {
  try {
    const eventContext = `Event: ${name}\n${description ? `Description: ${description}` : ''}`

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [
        {
          role: 'user',
          content: `${INFERENCE_PROMPT}\n\n${eventContext}`,
        },
      ],
    })

    const textBlock = message.content.find((block) => block.type === 'text')
    if (!textBlock?.text) {
      return { categories: ['other'], vibes: [] }
    }

    // Parse JSON response
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { categories: ['other'], vibes: [] }
    }

    const parsed = JSON.parse(jsonMatch[0])

    // Validate and filter to only valid values
    const categories = (parsed.categories || [])
      .filter((c: string) => VALID_CATEGORIES.includes(c))
      .slice(0, 3) as Category[]

    const vibes = (parsed.vibes || [])
      .filter((v: string) => VALID_VIBES.includes(v))
      .slice(0, 4) as Vibe[]

    return {
      categories: categories.length > 0 ? categories : ['other'],
      vibes,
    }
  } catch (error) {
    console.error('[eventbrite] AI inference error:', error)
    return { categories: ['other'], vibes: [] }
  }
}

// ---------------------------------------------------------------------------
// Combined Enrichment
// ---------------------------------------------------------------------------

export interface EventbriteEnrichmentResult {
  price: number | null
  is_free: boolean
  categories: Category[]
  vibes: Vibe[]
}

/**
 * Fully enrich an Eventbrite event with price, categories, and vibes
 *
 * @param eventUrl - Event page URL for price fetching
 * @param name - Event name for AI inference
 * @param description - Event description for AI inference
 */
export async function enrichEventbriteEvent(
  eventUrl: string,
  name: string,
  description: string | null
): Promise<EventbriteEnrichmentResult> {
  // Run price fetch and AI inference in parallel
  const [priceInfo, inference] = await Promise.all([
    fetchEventbritePrice(eventUrl),
    inferCategoriesAndVibes(name, description),
  ])

  return {
    price: priceInfo?.price ?? null,
    is_free: priceInfo?.isFree ?? true,
    categories: inference.categories,
    vibes: inference.vibes,
  }
}

export interface BatchEnrichmentResult {
  id: string
  price: number | null
  is_free: boolean
  categories: Category[]
  vibes: Vibe[]
  error?: string
}

/**
 * Batch enrich multiple Eventbrite events
 *
 * @param events - Events to enrich (must have id, link, name, description_es)
 * @param onProgress - Optional progress callback
 * @param delayMs - Delay between requests to avoid rate limiting
 */
export async function enrichEventbriteEventsBatch(
  events: Array<{ id: string; link: string; name: string; description_es: string | null }>,
  onProgress?: (current: number, total: number) => void,
  delayMs: number = 500
): Promise<BatchEnrichmentResult[]> {
  const results: BatchEnrichmentResult[] = []

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    onProgress?.(i + 1, events.length)

    try {
      const enrichment = await enrichEventbriteEvent(event.link, event.name, event.description_es)
      results.push({
        id: event.id,
        ...enrichment,
      })
    } catch (error) {
      results.push({
        id: event.id,
        price: null,
        is_free: true,
        categories: ['other'],
        vibes: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }

    // Add delay between requests
    if (i < events.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return results
}

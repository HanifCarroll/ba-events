/**
 * AI-powered Event Categorization
 *
 * Uses Claude Haiku to categorize events into 6 intent-based categories.
 * This module is used during import for all event sources.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { Category } from '@/shared/lib/types'
import { CLAUDE_MODEL } from '@/shared/lib/ai/constants'

const anthropic = new Anthropic()

// The 6 simplified categories
const VALID_CATEGORIES: Category[] = ['music', 'arts', 'food', 'social', 'sports', 'festival']

// Rate limiting constants
// Anthropic limit is 50 requests/minute, so we use 1500ms (40 req/min) to stay safely under
const DEFAULT_DELAY_MS = 1500
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 2000

/**
 * Check if an error is a rate limit error (429)
 */
function isRateLimitError(error: unknown): boolean {
  if (error instanceof Anthropic.RateLimitError) return true
  if (error instanceof Error) {
    return error.message.includes('429') || error.message.includes('rate_limit')
  }
  return false
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Result of a single categorization attempt
 */
export interface CategorizationResult {
  category: Category
  success: boolean
  fallback: boolean
  error?: string
}

/**
 * Statistics from batch categorization
 */
export interface CategorizationStats {
  total: number
  successful: number
  fallback: number
  errors: string[]
}

/**
 * Prompt for Haiku to categorize events
 */
const CATEGORIZATION_PROMPT = `Categorize this event into ONE of these categories:
- music: concerts, DJ sets, live performances, music festivals
- arts: theater, comedy, film, exhibitions, galleries, workshops, cultural events
- food: food markets, wine tastings, culinary events, restaurant events
- social: networking, meetups, parties, social gatherings, expat events
- sports: fitness, yoga, running, sports competitions, outdoor activities
- festival: multi-day festivals, large celebrations, fairs, carnivals

Based on the event name and description, choose the SINGLE most appropriate category.
If unclear, use "social" as the default.

Respond with ONLY the category name (lowercase), nothing else.`

/**
 * Categorize a single event using AI with detailed result
 * Returns both the category and information about whether it was a fallback
 * Includes exponential backoff retry for rate limit errors
 */
export async function categorizeEventWithResult(
  name: string,
  description: string | null | undefined
): Promise<CategorizationResult> {
  const eventContext = `Event: ${name}${description ? `\nDescription: ${description}` : ''}`

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const message = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 20,
        messages: [
          {
            role: 'user',
            content: `${CATEGORIZATION_PROMPT}\n\n${eventContext}`,
          },
        ],
      })

      const textBlock = message.content.find((block) => block.type === 'text')
      if (!textBlock?.text) {
        return {
          category: 'social',
          success: false,
          fallback: true,
          error: 'Empty AI response',
        }
      }

      const category = textBlock.text.trim().toLowerCase() as Category

      // Validate the response is a valid category
      if (VALID_CATEGORIES.includes(category)) {
        return { category, success: true, fallback: false }
      }

      const error = `Invalid category returned: "${textBlock.text}"`
      console.warn(`[ai-categorizer] ${error}, defaulting to social`)
      return { category: 'social', success: false, fallback: true, error }
    } catch (err) {
      // Check if this is a rate limit error and we have retries left
      if (isRateLimitError(err) && attempt < MAX_RETRIES - 1) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt) // 2s, 4s, 8s
        console.warn(
          `[ai-categorizer] Rate limited, waiting ${backoffMs}ms before retry ${attempt + 2}/${MAX_RETRIES}`
        )
        await sleep(backoffMs)
        continue
      }

      const error = err instanceof Error ? err.message : String(err)
      console.error('[ai-categorizer] Error categorizing event:', error)
      return { category: 'social', success: false, fallback: true, error }
    }
  }

  // Should not reach here, but TypeScript needs a return
  return { category: 'social', success: false, fallback: true, error: 'Max retries exceeded' }
}

/**
 * Categorize a single event using AI
 * Returns just the category for backward compatibility
 */
export async function categorizeEvent(
  name: string,
  description: string | null | undefined
): Promise<Category> {
  const result = await categorizeEventWithResult(name, description)
  return result.category
}

/**
 * Result from batch categorization including stats
 */
export interface BatchCategorizationResult {
  categories: Category[]
  stats: CategorizationStats
}

/**
 * Batch categorize multiple events with statistics
 * Processes events sequentially with a delay to avoid rate limits
 * Returns both the categories and stats about fallbacks/errors
 *
 * @param events - Array of events to categorize
 * @param delayMs - Delay between requests in ms (default: 1500ms to stay under 50 req/min limit)
 */
export async function categorizeEventsBatchWithStats(
  events: Array<{ name: string; description: string | null | undefined }>,
  delayMs: number = DEFAULT_DELAY_MS
): Promise<BatchCategorizationResult> {
  const categories: Category[] = []
  const stats: CategorizationStats = {
    total: events.length,
    successful: 0,
    fallback: 0,
    errors: [],
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    const result = await categorizeEventWithResult(event.name, event.description)
    categories.push(result.category)

    if (result.success) {
      stats.successful++
    } else {
      stats.fallback++
      if (result.error) {
        stats.errors.push(`${event.name}: ${result.error}`)
      }
    }

    // Add delay between requests to avoid rate limiting
    if (i < events.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  // Log summary if there were fallbacks
  if (stats.fallback > 0) {
    console.warn(
      `[ai-categorizer] Batch complete: ${stats.successful}/${stats.total} successful, ${stats.fallback} fallbacks`
    )
  }

  return { categories, stats }
}

/**
 * Batch categorize multiple events
 * Processes events sequentially with a delay to avoid rate limits
 * Returns just the categories for backward compatibility
 *
 * @param events - Array of events to categorize
 * @param delayMs - Delay between requests in ms (default: 1500ms to stay under 50 req/min limit)
 */
export async function categorizeEventsBatch(
  events: Array<{ name: string; description: string | null | undefined }>,
  delayMs: number = DEFAULT_DELAY_MS
): Promise<Category[]> {
  const result = await categorizeEventsBatchWithStats(events, delayMs)
  return result.categories
}

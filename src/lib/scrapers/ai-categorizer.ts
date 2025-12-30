/**
 * AI-powered Event Categorization
 *
 * Uses Claude Haiku to categorize events into 6 intent-based categories.
 * This module is used during import for all event sources.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { Category } from '@/lib/types'

const anthropic = new Anthropic()

// The 6 simplified categories
const VALID_CATEGORIES: Category[] = ['music', 'arts', 'food', 'social', 'sports', 'festival']

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
 * Categorize a single event using AI
 */
export async function categorizeEvent(
  name: string,
  description: string | null | undefined
): Promise<Category> {
  try {
    const eventContext = `Event: ${name}${description ? `\nDescription: ${description}` : ''}`

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
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
      return 'social'
    }

    const category = textBlock.text.trim().toLowerCase() as Category

    // Validate the response is a valid category
    if (VALID_CATEGORIES.includes(category)) {
      return category
    }

    console.warn(`[ai-categorizer] Invalid category returned: "${textBlock.text}", defaulting to social`)
    return 'social'
  } catch (error) {
    console.error('[ai-categorizer] Error categorizing event:', error)
    return 'social'
  }
}

/**
 * Batch categorize multiple events
 * Processes events sequentially with a small delay to avoid rate limits
 */
export async function categorizeEventsBatch(
  events: Array<{ name: string; description: string | null | undefined }>,
  delayMs: number = 100
): Promise<Category[]> {
  const results: Category[] = []

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    const category = await categorizeEvent(event.name, event.description)
    results.push(category)

    // Add delay between requests to avoid rate limiting
    if (i < events.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return results
}

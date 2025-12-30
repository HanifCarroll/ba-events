/**
 * Category Mapping for Meetup Events
 *
 * Maps Meetup categories to app categories
 */

import type { Category } from '@/lib/types'

/**
 * Meetup category to app category mapping
 */
const MEETUP_CATEGORY_MAP: Record<string, Category[]> = {
  // Social & Community
  'Social Activities': ['networking'],
  'Community & Environment': ['other'],
  'Identity & Language': ['other'],
  'Language & Culture': ['other'],

  // Professional
  'Career & Business': ['networking'],
  Technology: ['workshop'],

  // Hobbies & Recreation
  'Hobbies & Passions': ['other'],
  'Sports & Fitness': ['sports'],
  'Travel & Outdoor': ['other'],
  Games: ['other'],
  'Health & Wellbeing': ['other'],

  // Arts
  'Arts & Culture': ['art'],
}

/**
 * Keyword-based category refinement
 * Checks event name for more specific categorization
 */
const CATEGORY_KEYWORDS: Array<{ keywords: string[]; categories: Category[] }> = [
  // Music genres
  { keywords: ['jazz', 'blues'], categories: ['jazz'] },
  { keywords: ['rock', 'indie', 'punk'], categories: ['rock'] },
  { keywords: ['techno', 'electronic', 'edm', 'dj'], categories: ['techno', 'electronic'] },
  { keywords: ['house', 'disco'], categories: ['house', 'electronic'] },
  { keywords: ['tango', 'milonga'], categories: ['tango'] },
  { keywords: ['latin', 'salsa', 'cumbia', 'reggaeton'], categories: ['latin'] },
  { keywords: ['classical', 'orchestra', 'symphony'], categories: ['classical'] },
  { keywords: ['hip hop', 'hip-hop', 'rap'], categories: ['hip-hop'] },
  { keywords: ['folk', 'acoustic'], categories: ['folk'] },

  // Events
  { keywords: ['comedy', 'standup', 'stand-up', 'comedia'], categories: ['comedy'] },
  { keywords: ['theatre', 'theater', 'teatro', 'play', 'obra'], categories: ['theatre'] },
  { keywords: ['film', 'movie', 'cinema', 'cine', 'película'], categories: ['film'] },
  { keywords: ['art', 'gallery', 'exhibition', 'exposición', 'museo'], categories: ['art'] },
  { keywords: ['food', 'gastronomía', 'cooking', 'wine', 'vino', 'beer'], categories: ['food'] },
  { keywords: ['market', 'feria', 'mercado'], categories: ['market'] },
  { keywords: ['festival', 'fest'], categories: ['festival'] },
  { keywords: ['workshop', 'taller', 'class', 'curso', 'learn'], categories: ['workshop'] },
  { keywords: ['networking', 'business', 'entrepreneur', 'startup'], categories: ['networking'] },
  { keywords: ['sports', 'running', 'yoga', 'fitness', 'futbol', 'football'], categories: ['sports'] },

  // Tech events
  { keywords: ['javascript', 'python', 'react', 'node', 'programming', 'code', 'coding', 'developer', 'data science', 'ai', 'machine learning'], categories: ['workshop'] },
]

/**
 * Map Meetup category to app categories
 * Uses both direct mapping and keyword-based refinement
 */
export function mapMeetupCategory(
  meetupCategory: string | null,
  eventName?: string
): Category[] {
  // First try keyword-based mapping from event name
  if (eventName) {
    const lowerName = eventName.toLowerCase()
    for (const { keywords, categories } of CATEGORY_KEYWORDS) {
      for (const keyword of keywords) {
        if (lowerName.includes(keyword)) {
          return categories
        }
      }
    }
  }

  // Fall back to direct category mapping
  if (meetupCategory) {
    const normalized = meetupCategory.trim()
    const mapped = MEETUP_CATEGORY_MAP[normalized]
    if (mapped) {
      return mapped
    }
  }

  // Default to 'other'
  return ['other']
}

/**
 * Get list of known Meetup categories
 */
export function getKnownMeetupCategories(): string[] {
  return Object.keys(MEETUP_CATEGORY_MAP)
}

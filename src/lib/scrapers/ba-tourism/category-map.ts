/**
 * Category Mapping for BA Tourism Events
 *
 * Maps BA Tourism's category names to our app's category system.
 */

import type { Category } from '@/lib/types'

// Mapping from BA Tourism category to our categories
const BA_TOURISM_CATEGORY_MAP: Record<string, Category[]> = {
  // Arts & Performance
  Danza: ['other'], // No dance category in app, could infer from description
  Música: ['other'], // Will infer specific genre from description
  Teatro: ['theatre'],
  'Artes visuales': ['art'],
  Exposición: ['art'],

  // Events
  Evento: ['other'],
  'Visita guiada': ['other'],
  Feria: ['market'],
  Festival: ['festival'],

  // Other
  Infantil: ['other'], // Will add 'family-friendly' vibe
  Deporte: ['sports'],
  Gastronomía: ['food'],
  'Aire libre': ['other'], // Will add 'outdoor' vibe
}

/**
 * Map a BA Tourism category to our app's categories
 */
export function mapBATourismCategory(category: string | null | undefined): Category[] {
  if (!category) return ['other']

  const normalized = category.trim()
  const mapped = BA_TOURISM_CATEGORY_MAP[normalized]

  if (mapped) return mapped

  // Try case-insensitive match
  const lowerCategory = normalized.toLowerCase()
  for (const [key, value] of Object.entries(BA_TOURISM_CATEGORY_MAP)) {
    if (key.toLowerCase() === lowerCategory) {
      return value
    }
  }

  // Log unknown categories for future mapping
  console.log(`[BA Tourism] Unknown category: "${category}"`)
  return ['other']
}

/**
 * Get all known BA Tourism categories for debugging
 */
export function getKnownBATourismCategories(): string[] {
  return Object.keys(BA_TOURISM_CATEGORY_MAP)
}

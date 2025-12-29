/**
 * Category Mapping for Passline Events
 *
 * Maps Passline's category names to our app's category system.
 */

import type { Category } from '@/lib/types'

// Mapping from Passline category_name to our categories
const PASSLINE_CATEGORY_MAP: Record<string, Category[]> = {
  // Music
  Conciertos: ['rock'],
  Electrónica: ['electronic'],
  Jazz: ['jazz'],
  Rock: ['rock'],
  Clásica: ['classical'],
  Folclore: ['folk'],
  Reggaeton: ['reggaeton'],
  'Hip Hop': ['hip-hop'],
  Latino: ['latin'],
  Tango: ['tango'],

  // Arts & Culture
  'Arte & Cultura': ['art'],
  Teatro: ['theatre'],
  'Stand Up': ['comedy'],

  // Food & Drink
  'Food & Drink': ['food'],
  Gastronomía: ['food'],

  // Events
  Festivales: ['festival'],
  Fiestas: ['other'],
  Bar: ['other'],
  Workshops: ['workshop'],
  Networking: ['networking'],

  // Other
  'Casino Night': ['other'],
  'Despedida de soltero': ['other'],
  'Festa Universitaria': ['other'],
  'Entradas y Eventos': ['other'],
}

/**
 * Map a Passline category to our app's categories
 */
export function mapPasslineCategory(passlineCategory: string | null | undefined): Category[] {
  if (!passlineCategory) return ['other']

  const normalized = passlineCategory.trim()
  const mapped = PASSLINE_CATEGORY_MAP[normalized]

  if (mapped) return mapped

  // Try case-insensitive match
  const lowerCategory = normalized.toLowerCase()
  for (const [key, value] of Object.entries(PASSLINE_CATEGORY_MAP)) {
    if (key.toLowerCase() === lowerCategory) {
      return value
    }
  }

  // Log unknown categories for future mapping
  console.log(`[Passline] Unknown category: "${passlineCategory}"`)
  return ['other']
}

/**
 * Get all known Passline categories for debugging
 */
export function getKnownPasslineCategories(): string[] {
  return Object.keys(PASSLINE_CATEGORY_MAP)
}

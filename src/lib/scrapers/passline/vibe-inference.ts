/**
 * Vibe Inference for Passline Events
 *
 * Infers vibes from event data based on keywords and patterns.
 */

import type { Vibe } from '@/lib/types'
import type { PasslineEvent } from './api'

// Keywords that suggest specific vibes
const VIBE_KEYWORDS: Record<Vibe, string[]> = {
  underground: ['underground', 'rave', 'after', 'warehouse', 'secreto'],
  mainstream: ['mainstream', 'comercial', 'top 40', 'hits'],
  chill: ['chill', 'relax', 'lounge', 'acústico', 'acoustic', 'jazz', 'ambient'],
  'high-energy': ['fiesta', 'party', 'dance', 'techno', 'rave', 'electrónica'],
  romantic: ['romantic', 'tango', 'bolero', 'love', 'parejas'],
  'family-friendly': ['familia', 'niños', 'kids', 'infantil', 'familiar'],
  'lgbtq-friendly': ['lgbtq', 'pride', 'queer', 'gay', 'diversidad'],
  'expat-friendly': ['expat', 'english', 'international', 'foreigners'],
  local: ['local', 'barrio', 'vecinal'],
  touristy: ['turista', 'tourist', 'tour'],
  intimate: ['íntimo', 'intimate', 'acústico', 'pequeño', 'exclusivo'],
  massive: ['festival', 'masivo', 'massive', 'estadio', 'arena'],
  outdoor: ['outdoor', 'aire libre', 'terraza', 'rooftop', 'parque'],
  rooftop: ['rooftop', 'terraza', 'azotea'],
}

// Categories that suggest specific vibes
const CATEGORY_VIBES: Record<string, Vibe[]> = {
  Jazz: ['chill', 'intimate'],
  Clásica: ['chill'],
  Tango: ['romantic', 'intimate'],
  Electrónica: ['high-energy'],
  Festivales: ['massive', 'high-energy'],
  'Stand Up': ['chill'],
  'Food & Drink': ['chill'],
}

/**
 * Infer vibes from a Passline event
 */
export function inferVibes(event: PasslineEvent): Vibe[] {
  const vibes = new Set<Vibe>()

  // Check event name and description for keywords
  const searchText = [
    event.nombre,
    event.lugar,
    event.artistas,
    event.category_name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  // Check keywords
  for (const [vibe, keywords] of Object.entries(VIBE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        vibes.add(vibe as Vibe)
        break
      }
    }
  }

  // Check category-based vibes
  if (event.category_name && CATEGORY_VIBES[event.category_name]) {
    for (const vibe of CATEGORY_VIBES[event.category_name]) {
      vibes.add(vibe)
    }
  }

  // Large capacity events are likely massive
  const disponibles = parseInt(event.disponibles, 10)
  if (!isNaN(disponibles) && disponibles > 1000) {
    vibes.add('massive')
  } else if (!isNaN(disponibles) && disponibles < 100) {
    vibes.add('intimate')
  }

  return Array.from(vibes)
}

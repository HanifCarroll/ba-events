/**
 * Vibe Inference for BA Tourism Events
 *
 * Infers event vibes based on category, venue, and description.
 */

import type { Vibe } from '@/lib/types'
import type { BATourismEvent } from './types'

// Keywords that suggest specific vibes
const VIBE_KEYWORDS: Record<Vibe, string[]> = {
  underground: ['alternativo', 'independiente', 'under', 'experimental'],
  mainstream: ['popular', 'famoso', 'conocido', 'hit'],
  chill: ['tranquilo', 'relajante', 'calma', 'paz', 'contemplativo'],
  'high-energy': ['fiesta', 'baile', 'bailar', 'energía', 'explosivo'],
  romantic: ['romántico', 'pareja', 'amor', 'íntimo'],
  'family-friendly': ['niños', 'familia', 'infantil', 'todas las edades', 'para chicos'],
  'lgbtq-friendly': ['lgbtq', 'diversidad', 'orgullo', 'pride'],
  'expat-friendly': ['inglés', 'english', 'internacional', 'extranjeros'],
  local: ['porteño', 'barrio', 'vecinos', 'comunidad'],
  touristy: ['turístico', 'turista', 'icónico', 'imperdible'],
  intimate: ['íntimo', 'pequeño', 'acogedor', 'exclusivo'],
  massive: ['masivo', 'multitudinario', 'miles', 'festival'],
  outdoor: ['aire libre', 'parque', 'plaza', 'jardín', 'exterior'],
  rooftop: ['terraza', 'rooftop', 'azotea'],
}

// Venues that suggest touristy vibes
const TOURISTY_VENUES = [
  'obelisco',
  'teatro colón',
  'la boca',
  'caminito',
  'plaza de mayo',
  'casa rosada',
  'recoleta',
  'cementerio',
  'puerto madero',
]

// Venues that suggest outdoor vibes
const OUTDOOR_VENUES = [
  'parque',
  'plaza',
  'jardín',
  'bosques',
  'costanera',
  'reserva ecológica',
]

/**
 * Infer vibes from a BA Tourism event
 */
export function inferVibes(event: BATourismEvent): Vibe[] {
  const vibes: Set<Vibe> = new Set()
  const lowerName = event.name.toLowerCase()
  const lowerDescription = event.description.toLowerCase()
  const lowerVenue = event.venueName.toLowerCase()
  const lowerCategory = event.category.toLowerCase()
  const searchText = `${lowerName} ${lowerDescription} ${lowerVenue}`

  // Category-based vibes
  if (lowerCategory === 'infantil' || lowerCategory.includes('infantil')) {
    vibes.add('family-friendly')
  }

  if (lowerCategory === 'aire libre' || lowerCategory.includes('aire libre')) {
    vibes.add('outdoor')
  }

  // Venue-based vibes
  for (const venue of TOURISTY_VENUES) {
    if (lowerVenue.includes(venue) || lowerName.includes(venue)) {
      vibes.add('touristy')
      break
    }
  }

  for (const venue of OUTDOOR_VENUES) {
    if (lowerVenue.includes(venue)) {
      vibes.add('outdoor')
      break
    }
  }

  // Keyword-based vibes
  for (const [vibe, keywords] of Object.entries(VIBE_KEYWORDS) as [Vibe, string[]][]) {
    for (const keyword of keywords) {
      if (searchText.includes(keyword)) {
        vibes.add(vibe)
        break
      }
    }
  }

  // Free government events are often touristy or local
  if (event.isFree) {
    // Government-run events at iconic locations are touristy
    if (
      event.moreInfoUrl.includes('turismo.buenosaires.gob.ar') &&
      (lowerVenue.includes('colón') || lowerVenue.includes('obelisco'))
    ) {
      vibes.add('touristy')
    }
  }

  // If no vibes were inferred, don't add any (let transformer handle defaults)
  return Array.from(vibes)
}

/**
 * Vibe Inference for Meetup Events
 *
 * Infers event vibes from event data using keyword matching and heuristics
 */

import type { Vibe } from '@/lib/types'
import type { MeetupEvent } from './types'

/**
 * Keywords associated with each vibe
 */
const VIBE_KEYWORDS: Record<Vibe, string[]> = {
  underground: ['underground', 'alternative', 'indie', 'experimental', 'alternativo'],
  mainstream: ['popular', 'mainstream', 'hits', 'famoso'],
  chill: [
    'chill',
    'relaxed',
    'casual',
    'social',
    'coffee',
    'brunch',
    'tranquilo',
    'relajado',
    'picnic',
    'lounge',
  ],
  'high-energy': [
    'dance',
    'dancing',
    'party',
    'fiesta',
    'adventure',
    'baile',
    'bailar',
    'club',
    'rave',
  ],
  romantic: ['romantic', 'couples', 'date night', 'romántico', 'parejas'],
  'family-friendly': [
    'family',
    'families',
    'kids',
    'children',
    'all ages',
    'familia',
    'niños',
    'infantil',
  ],
  'lgbtq-friendly': ['lgbtq', 'queer', 'pride', 'gay', 'lesbian', 'lgbt', 'lgbtiq'],
  'expat-friendly': [
    'expat',
    'expats',
    'english',
    'international',
    'foreigners',
    'english speaking',
    'english-speaking',
    'intercambio',
    'language exchange',
  ],
  local: ['local', 'porteño', 'barrio', 'neighborhood', 'vecinos'],
  touristy: ['tourist', 'tourists', 'tour', 'sightseeing', 'turista', 'turismo'],
  intimate: ['small group', 'intimate', 'exclusive', 'limited', 'íntimo', 'pequeño grupo'],
  massive: ['festival', 'massive', 'large', 'masivo', 'multitudinario'],
  outdoor: ['outdoor', 'outdoors', 'hiking', 'park', 'parque', 'nature', 'rooftop', 'terraza', 'al aire libre'],
  rooftop: ['rooftop', 'terraza', 'azotea'],
}

/**
 * Group name patterns that indicate specific vibes
 */
const EXPAT_GROUP_PATTERNS = [
  'english',
  'expat',
  'international',
  'language exchange',
  'intercambio',
  'foreigners',
  'newcomers',
]

const LGBTQ_GROUP_PATTERNS = ['lgbtq', 'queer', 'pride', 'gay', 'lesbian', 'rainbow']

/**
 * Infer vibes from a Meetup event
 */
export function inferVibes(event: MeetupEvent): Vibe[] {
  const vibes = new Set<Vibe>()

  // Combine text sources for keyword matching
  const searchText = [
    event.name,
    event.description || '',
    event.group.name,
    event.venue?.name || '',
    event.category || '',
  ]
    .join(' ')
    .toLowerCase()

  // Keyword-based inference
  for (const [vibe, keywords] of Object.entries(VIBE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        vibes.add(vibe as Vibe)
        break
      }
    }
  }

  // Group name patterns
  const groupLower = event.group.name.toLowerCase()

  // Check expat-friendly patterns
  for (const pattern of EXPAT_GROUP_PATTERNS) {
    if (groupLower.includes(pattern)) {
      vibes.add('expat-friendly')
      break
    }
  }

  // Check LGBTQ patterns
  for (const pattern of LGBTQ_GROUP_PATTERNS) {
    if (groupLower.includes(pattern)) {
      vibes.add('lgbtq-friendly')
      break
    }
  }

  // Attendance-based vibes
  if (event.attendeeCount > 100) {
    vibes.add('massive')
  } else if (event.attendeeCount > 0 && event.attendeeCount < 15) {
    vibes.add('intimate')
  }

  // Venue-based vibes
  if (event.venue?.name) {
    const venueLower = event.venue.name.toLowerCase()

    // Outdoor venues
    if (
      venueLower.includes('park') ||
      venueLower.includes('parque') ||
      venueLower.includes('plaza') ||
      venueLower.includes('jardín') ||
      venueLower.includes('reserva')
    ) {
      vibes.add('outdoor')
    }

    // Rooftop venues
    if (
      venueLower.includes('rooftop') ||
      venueLower.includes('terraza') ||
      venueLower.includes('azotea')
    ) {
      vibes.add('rooftop')
      vibes.add('outdoor')
    }
  }

  // Category-based vibes
  if (event.category) {
    const categoryLower = event.category.toLowerCase()

    if (categoryLower.includes('social')) {
      vibes.add('chill')
    }

    if (categoryLower.includes('sports') || categoryLower.includes('fitness')) {
      vibes.add('high-energy')
    }
  }

  // Free events are often chill/social
  if (event.price === null || event.price === 0) {
    if (!vibes.has('high-energy') && !vibes.has('massive')) {
      vibes.add('chill')
    }
  }

  // Remove conflicting vibes
  if (vibes.has('intimate') && vibes.has('massive')) {
    vibes.delete('intimate')
  }

  if (vibes.has('underground') && vibes.has('mainstream')) {
    // Prefer underground if explicitly mentioned
    if (searchText.includes('underground')) {
      vibes.delete('mainstream')
    } else {
      vibes.delete('underground')
    }
  }

  return Array.from(vibes)
}

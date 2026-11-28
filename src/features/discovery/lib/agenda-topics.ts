import { normalizeText } from '#shared/lib/utils/normalize-text.ts'
import type { EventFacetGenre } from '#shared/lib/search-facets.ts'
import type { AgendaListing } from '#shared/lib/db/event-reads-d1.server.ts'

export const topicRules = {
  teatro: (event: AgendaListing) => /\b(?:teatro|teatral(?:es)?|unipersonal(?:es)?)\b/.test(normalizeText(event.name)) ||
    /\bteatro\b/.test(normalizeText(event.venue_name ?? '')),
  'musica-en-vivo': (event: AgendaListing) => event.music,
  ferias: (event: AgendaListing) => /(?:^ferias?\b|\bferias? (?:de|del|artesanal|editorial|cultural|gastronomica)\b)/.test(normalizeText(event.name)),
  muestras: (event: AgendaListing) => Boolean(event.details.facets?.eventType.includes('exhibition')),
  poesia: (event: AgendaListing) => /\b(?:poesia|poemas?|lecturas? (?:literarias?|de poesia|de poemas?))\b/.test(normalizeText(event.name)) ||
    /\b(?:ciclo|noche|lecturas?|recital|encuentro) de (?:poesia|poemas?)\b/.test(normalizeText(event.details.description_es ?? '')),
  tango: (event: AgendaListing) => Boolean(event.details.facets?.genres.includes('tango')) ||
    /\b(?:tango|milongas?)\b/.test(normalizeText(event.name)),
}

export type AgendaTopic = keyof typeof topicRules

export const genreLabels: Record<EventFacetGenre, string> = {
  techno: 'techno', house: 'house', jazz: 'jazz', tango: 'tango', rock: 'rock', folk: 'folk',
  classical: 'música clásica', reggaeton: 'reguetón', 'hip-hop': 'hip hop', indie: 'indie', electronic: 'electrónica',
}

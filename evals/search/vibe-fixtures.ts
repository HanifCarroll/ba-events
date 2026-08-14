#!/usr/bin/env bun
/**
 * Synthetic event corpus for the vibe-search eval and tests.
 *
 * Fixed, deterministic records — the vibe scorer is pure, so the labeled set
 * in vibe-golden.ts never goes stale the way DB-labeled semantic sets do.
 * Dates are pinned to December 2026 (future relative to authoring) so
 * today/tomorrow signals are always negative; weekday/weekend signals are
 * date-independent and pinned: 2026-12-18 is a Friday, 12-19 Saturday,
 * 12-20 Sunday, 12-16 Wednesday (Buenos Aires time).
 *
 * Because NO fixture starts today/tomorrow, the scorer's today/tonight
 * context penalty (-6) applies UNIFORMLY across the corpus for queries with
 * a today/tonight signal (e.g. "chill tonight", "algo tranqui esta noche").
 * It shifts absolute scores but not relative order, so the golden labels for
 * those queries still pin ranking behavior. Hard time filtering is out of
 * scope here: the ranker receives already-filtered candidates from
 * search_events, and the fixture corpus never exercises a filtered subset.
 */

import type { ChatEventPayload } from '@/shared/lib/types'

interface FixtureOverrides {
  id: string
  name: string
  categories: string[]
  starts_at: string
  venue_neighborhood: ChatEventPayload['venue_neighborhood']
  description_es?: string | null
  description_en?: string | null
  is_free?: boolean
  price?: number | null
  venue_name?: string | null
  image_url?: string | null
  location_tba?: boolean
  description_unavailable?: boolean
}

function fixture(overrides: FixtureOverrides): ChatEventPayload {
  const base = new Date(overrides.starts_at)
  const ends = new Date(base.getTime() + 3 * 60 * 60 * 1000)
  return {
    id: overrides.id,
    name: overrides.name,
    description_es: overrides.description_es ?? null,
    description_en: overrides.description_en ?? null,
    description_display_es: overrides.description_es ?? null,
    description_display_en: overrides.description_en ?? null,
    description_summary_es: overrides.description_es ?? null,
    description_summary_en: overrides.description_en ?? null,
    starts_at: overrides.starts_at,
    ends_at: ends.toISOString(),
    is_all_day: false,
    time_tba: false,
    venue_id: `venue-${overrides.id}`,
    categories: overrides.categories,
    price: overrides.price ?? null,
    is_free: overrides.is_free ?? false,
    min_age: null,
    image_url: overrides.image_url ?? null,
    link: null,
    ticket_url: null,
    source: 'fixture',
    external_id: null,
    status: 'scheduled',
    location_hidden: false,
    location_tba: overrides.location_tba ?? false,
    description_unavailable: overrides.description_unavailable ?? false,
    enrichment_status: 'completed',
    enrichment_error: null,
    enriched_at: '2026-08-01T00:00:00.000Z',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    venue_name: overrides.venue_name ?? `Venue ${overrides.id}`,
    venue_neighborhood: overrides.venue_neighborhood,
    venue_address: `${overrides.venue_neighborhood ?? 'CABA'}, Buenos Aires`,
  }
}

export const VIBE_FIXTURES: ChatEventPayload[] = [
  fixture({
    id: 'yoga-palermo',
    name: 'Yoga & Meditación en Palermo',
    categories: ['social', 'sports'],
    starts_at: '2026-12-20T13:00:00.000Z', // Sunday 10:00 BA
    venue_neighborhood: 'Palermo',
    venue_name: 'Parque Las Heras',
    image_url: 'https://example.com/yoga.jpg',
    description_es:
      'Clase de yoga y meditación al aire libre, ambiente tranquilo, chill y relajado, ideal para desconectar.',
    description_en: 'Outdoor yoga and meditation class, calm, chill and relaxed vibe, perfect to unwind.',
  }),
  fixture({
    id: 'brunch-domingo',
    name: 'Brunch de Domingo en el Parque',
    categories: ['food'],
    starts_at: '2026-12-20T14:00:00.000Z', // Sunday 11:00 BA
    venue_neighborhood: 'Caballito',
    venue_name: 'Parque Rivadavia',
    image_url: 'https://example.com/brunch.jpg',
    description_es: 'Brunch relajado al aire libre con café, tostadas y música suave.',
  }),
  fixture({
    id: 'feria-gratis',
    name: 'Feria de Artesanos',
    categories: ['arts', 'food'],
    starts_at: '2026-12-19T14:00:00.000Z', // Saturday 11:00 BA
    venue_neighborhood: 'Villa Crespo',
    venue_name: 'Plaza Armenia',
    image_url: 'https://example.com/feria.jpg',
    is_free: true,
    description_es: 'Feria al aire libre con entrada gratis, artesanías, plantas y food trucks.',
    description_en: 'Outdoor fair with free entry, crafts, plants and food trucks.',
  }),
  fixture({
    id: 'techno-fabrik',
    name: 'Fabrik Techno Night',
    categories: ['music'],
    starts_at: '2026-12-19T23:00:00.000Z', // Saturday 20:00 BA
    venue_neighborhood: 'Palermo',
    venue_name: 'Fabrik Club',
    image_url: 'https://example.com/fabrik.jpg',
    price: 15000,
    description_es: 'Underground techno minimal, house y psytrance, pista con luces hasta las 6am.',
    description_en: 'Underground techno minimal, house and psytrance, light show until 6am.',
  }),
  fixture({
    id: 'reggaeton-bar',
    name: 'Perreo en La Rural',
    categories: ['music', 'social'],
    starts_at: '2026-12-19T22:00:00.000Z', // Saturday 19:00 BA
    venue_neighborhood: 'Palermo',
    venue_name: 'La Rural',
    image_url: 'https://example.com/perreo.jpg',
    price: 12000,
    description_es: 'Noche de reggaetón y baile, música a todo volumen.',
  }),
  fixture({
    id: 'maraton',
    name: 'Maratón de Buenos Aires 10K',
    categories: ['sports'],
    starts_at: '2026-12-19T11:00:00.000Z', // Saturday 08:00 BA
    venue_neighborhood: 'Palermo',
    venue_name: 'Figueroa Alcorta',
    price: 8000,
    description_es: 'Carrera competitiva de 10 kilómetros por Palermo.',
  }),
  fixture({
    id: 'cena-romantica',
    name: 'Cena Romántica con Música en Vivo',
    categories: ['music'],
    starts_at: '2026-12-18T22:00:00.000Z', // Friday 19:00 BA
    venue_neighborhood: 'San Telmo',
    venue_name: 'Café San Telmo',
    image_url: 'https://example.com/cena.jpg',
    price: 25000,
    description_es: 'Velada íntima con cena, vino y jazz en vivo. Perfecto para parejas.',
    description_en: 'Intimate evening with dinner, wine and live jazz. Perfect for couples.',
  }),
  fixture({
    id: 'tango-milonga',
    name: 'Milonga en San Telmo',
    categories: ['music', 'arts'],
    starts_at: '2026-12-20T20:00:00.000Z', // Sunday 17:00 BA
    venue_neighborhood: 'San Telmo',
    venue_name: 'Salón San Telmo',
    is_free: true,
    description_es: 'Milonga tradicional con clases de tango y música en vivo.',
  }),
  fixture({
    id: 'charla-tecnologia',
    name: 'Charlas de Tecnología y Networking',
    categories: ['social'],
    starts_at: '2026-12-16T21:00:00.000Z', // Wednesday 18:00 BA
    venue_neighborhood: 'Recoleta',
    venue_name: 'WeWork Recoleta',
    price: 3000,
    description_es: 'Talks de ingeniería, product y networking con cerveza artesanal.',
  }),
  fixture({
    id: 'feria-libros',
    name: 'Feria de Libros Independientes',
    categories: ['arts'],
    starts_at: '2026-12-20T15:00:00.000Z', // Sunday 12:00 BA
    venue_neighborhood: 'Recoleta',
    venue_name: 'Plaza Francia',
    is_free: true,
    description_es: 'Editoriales independientes, lecturas y firma de autores. Entrada gratis.',
  }),
]

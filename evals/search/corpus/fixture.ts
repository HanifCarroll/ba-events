/**
 * Committed synthetic corpus fixture for the offline search relevance eval.
 *
 * Source of truth for `evals/search/corpus/events.json`. The snapshot script
 * falls back to this set when the live DB is unreachable, and the relevance
 * runner labels against these stable ids.
 *
 * Only RAW fields are stored (no embeddings); Phase 6 rebuilds documents.
 *
 * All ids are synthetic stable UUIDs — deliberately NOT production ids. Do not
 * push these to production code paths.
 *
 * Calendar (Buenos Aires time, UTC-3 year-round):
 *   Runner pins "now" to Thu 2026-08-13 12:00 BA, so:
 *     tonight            = Thu Aug 13 18:00 -> Fri 06:00
 *     tomorrow           = Fri Aug 14
 *     this weekend       = Sat Aug 15 -> Mon Aug 17 00:00
 * Events are placed accordingly, every start indexed by its BA wall-clock
 * weekday derived from the `starts_at` instant.
 */

import { fromZonedTime } from 'date-fns-tz'
import { BA_TIMEZONE } from '@/shared/lib/constants'
import type { CorpusEvent, CorpusVenue } from './types'

/** Stable fake venue ids (not production). */
export const VENUES = {
  niceto: '11111111-1111-4000-8000-000000000001',
  cafeSanTelmo: '11111111-1111-4000-8000-000000000002',
  salasanTelmo: '11111111-1111-4000-8000-000000000003',
  warehouse: '11111111-1111-4000-8000-000000000004',
  boedoBar: '11111111-1111-4000-8000-000000000005',
  tercerParque: '11111111-1111-4000-8000-000000000006',
}

// ---------------------------------------------------------------------------
// date helper: BA wall-clock → UTC ISO
// ---------------------------------------------------------------------------
function ba(year: number, month: number, day: number, hour: number, minute = 0): string {
  // date-fns months are 0-indexed like JS Date.
  return fromZonedTime(new Date(year, month - 1, day, hour, minute), BA_TIMEZONE).toISOString()
}

function venue(
  id?: keyof typeof VENUES,
  name: string | null = null,
  neighborhood: string | null = null
): CorpusVenue {
  return { id: id ? VENUES[id] : null, name, neighborhood }
}

/** A TBA venue (no venue id) but with a known area — used for street/TBA events. */
function area(neighborhood: string, name: string | null = null): CorpusVenue {
  return { id: null, name, neighborhood }
}

interface FixtureSpec {
  id: string
  name: string
  es: string
  en?: string | null
  categories: string[]
  when: string // ba() output already
  venue: CorpusVenue
  is_free?: boolean
  price?: number | null
  min_age?: number | null
  location_tba?: boolean
  time_tba?: boolean
  image_url?: string | null
  facets?: Record<string, unknown>
}

/** Build a full CorpusEvent from a compact spec, filling defaults. */
function ev(spec: FixtureSpec): CorpusEvent {
  return {
    id: spec.id,
    name: spec.name,
    descriptions: {
      es: spec.es,
      en: spec.en ?? null,
      es_summary: spec.es,
      en_summary: spec.en ?? null,
    },
    categories: spec.categories,
    facets: spec.facets ?? {},
    venue: spec.venue,
    starts_at: spec.when,
    is_free: spec.is_free ?? false,
    price: spec.price ?? (spec.is_free ? 0 : null),
    image_url: spec.image_url ?? null,
    location_tba: spec.location_tba ?? false,
    time_tba: spec.time_tba ?? false,
    min_age: spec.min_age ?? null,
  }
}

export const FIXTURE_EVENTS: CorpusEvent[] = [
  // --- techno / Niceto / age-restricted ---
  ev({
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Techno Night en Niceto Club',
    es: 'Noche de techno underground y house en Niceto. Ingreso solo mayores de 18 con DNI. Persisten hasta las 6am.',
    en: 'Underground techno and house night at Niceto. 18+ only. Open until 6am.',
    categories: ['music'],
    when: ba(2026, 8, 15, 23, 0), // Sat Aug 15 23:00 BA
    venue: venue('niceto', 'Niceto Club', 'Palermo'),
    price: 15000,
    min_age: 18,
    facets: { genres: ['techno', 'house'], ageRestriction: '18+', vibe: 'lively' },
  }),
  ev({
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Sun Session Niceto',
    es: 'Session de la tarde en Niceto con indie y funk, ambiente distendido para charlar.',
    en: 'Afternoon session at Niceto with indie and funk, relaxed vibe for chatting.',
    categories: ['music', 'social'],
    when: ba(2026, 8, 16, 19, 0), // Sun Aug 16 19:00 BA
    venue: venue('niceto', 'Niceto Club', 'Palermo'),
    price: 12000,
    facets: { genres: ['indie', 'funk'], vibe: 'chill' },
  }),
  ev({
    id: '00000000-0000-4000-8000-000000000006',
    name: 'Warehouse Techno Miller',
    es: 'Rave de techno industrial en un galpón de Palermo. Evento 18+.',
    en: 'Industrial techno rave in a Palermo warehouse. 18+ event.',
    categories: ['music'],
    when: ba(2026, 8, 16, 23, 0), // Sun Aug 16 23:00 BA
    venue: venue('warehouse', 'Miller Warehouse', 'Palermo'),
    price: 13000,
    min_age: 18,
    facets: { genres: ['techno'], ageRestriction: '18+' },
  }),

  // --- jazz / romantic ---
  ev({
    id: '00000000-0000-4000-8000-000000000004',
    name: 'Cena Romántica con Jazz en Vivo',
    es: 'Velada íntima en San Telmo con cena, vino y jazz en vivo. Perfecto para parejas.',
    en: 'Intimate San Telmo evening with dinner, wine and live jazz. Perfect for couples.',
    categories: ['music', 'food'],
    when: ba(2026, 8, 15, 21, 0), // Sat Aug 15 21:00 BA
    venue: venue('cafeSanTelmo', 'Café San Telmo', 'San Telmo'),
    price: 25000,
    facets: { genres: ['jazz'], vibe: 'romantic' },
  }),
  ev({
    id: '00000000-0000-4000-8000-000000000012',
    name: 'Jazz Íntimo de Domingo',
    es: 'Trío de jazz en San Telmo, entrada moderada, ambiente tranquilo y acogedor.',
    en: 'Jazz trio in San Telmo, moderate entry, quiet and cozy atmosphere.',
    categories: ['music'],
    when: ba(2026, 8, 16, 20, 0), // Sun Aug 16 20:00 BA
    venue: venue('salasanTelmo', 'Salón San Telmo', 'San Telmo'),
    price: 12000,
    facets: { genres: ['jazz'], vibe: 'romantic' },
  }),
  ev({
    id: '00000000-0000-4000-8000-000000000014',
    name: 'Noche Clásica del Recoleta',
    es: 'Concierto de música clásica y cuerdas en Recoleta.',
    en: 'Classical strings concert in Recoleta.',
    categories: ['music', 'arts'],
    when: ba(2026, 8, 15, 20, 0), // Sat Aug 15 20:00 BA
    venue: area('Recoleta', 'Usina del Arte Recoleta'),
    price: 20000,
    facets: { genres: ['classical'] },
  }),

  // --- free / Palermo / weekend ---
  ev({
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Yoga & Meditación al Aire Libre',
    es: 'Clase de yoga y meditación en Palermo, ambiente tranquilo y chill para desconectar. Gratuita.',
    en: 'Outdoor yoga and meditation class in Palermo, calm and chill. Free.',
    categories: ['sports', 'social'],
    when: ba(2026, 8, 15, 10, 0), // Sat Aug 15 10:00 BA
    venue: venue('tercerParque', 'Bosques de Palermo', 'Palermo'),
    is_free: true,
    facets: { vibes: ['chill', 'yoga'], activity: 'yoga' },
  }),
  ev({
    id: '00000000-0000-4000-8000-000000000008',
    name: 'Palermo Rooftop Gratis Happy Hour',
    es: 'Festival gratuito en una terraza de Palermo al atardecer, con DJ y comida.',
    en: 'Free rooftop festival in Palermo at sunset with DJ and food.',
    categories: ['festival', 'music'],
    when: ba(2026, 8, 15, 14, 0), // Sat Aug 15
    venue: area('Palermo', 'Terraza Palermo'),
    is_free: true,
    facets: { vibe: 'festive', price: 'free' },
  }),
  ev({
    id: '00000000-0000-4000-8000-000000000009',
    name: 'Feria de Diseño en Palermo',
    es: 'Feria gratuita de diseño, plantas y comida callejera en Palermo.',
    en: 'Free design fair with plants and street food in Palermo.',
    categories: ['arts', 'food'],
    when: ba(2026, 8, 16, 11, 0), // Sun Aug 16
    venue: venue('tercerParque', 'Plaza Palermo', 'Palermo'),
    is_free: true,
    facets: { price: 'free' },
  }),
  ev({
    id: '00000000-0000-4000-8000-000000000015',
    name: 'Trivia y Birra Gratis Palermo',
    es: 'Noche de trivia gratuita en Palermo con cerveza artesanal barata.',
    en: 'Free trivia night in Palermo with cheap craft beer.',
    categories: ['social'],
    when: ba(2026, 8, 16, 18, 0), // Sun Aug 16
    venue: venue('boedoBar', 'Bar de Palermo', 'Palermo'),
    is_free: true,
    facets: { vibe: 'chill' },
  }),
  ev({
    id: '00000000-0000-4000-8000-000000000019',
    name: 'Muestra de Arte Gratuita Palermo',
    es: 'Exposición gratuita de arte contemporáneo en un espacio de Palermo.',
    en: 'Free contemporary art exhibition in Palermo.',
    categories: ['arts'],
    when: ba(2026, 8, 16, 12, 0), // Sun Aug 16
    venue: area('Palermo', 'Galería Palermo'),
    is_free: true,
    facets: { price: 'free' },
  }),
  ev({
    id: '00000000-0000-4000-8000-000000000016',
    name: 'Acústico a la Gorra en Niceto',
    es: 'Recital acústico a la gorra (entrada libre y a modo de colaboración) en Niceto.',
    en: 'Acoustic concert with pay-what-you-like ("a la gorra") entry at Niceto.',
    categories: ['music'],
    when: ba(2026, 8, 15, 17, 0), // Sat Aug 15
    venue: venue('niceto', 'Niceto Club', 'Palermo'),
    is_free: true,
    facets: { genres: ['acoustic'], price: 'a-la-gorra' },
  }),

  // --- San Telmo ---
  ev({
    id: '00000000-0000-4000-8000-000000000005',
    name: 'Milonga Tradicional en San Telmo',
    es: 'Milonga gratuita en San Telmo con clase previa de tango y música en vivo.',
    en: 'Free milonga in San Telmo with a tango class and live music.',
    categories: ['music', 'arts'],
    when: ba(2026, 8, 16, 17, 0), // Sun Aug 16
    venue: venue('salasanTelmo', 'Salón San Telmo', 'San Telmo'),
    is_free: true,
    facets: { genres: ['tango'], price: 'free' },
  }),
  ev({
    id: '00000000-0000-4000-8000-000000000010',
    name: 'Tango Callejero San Telmo',
    es: 'Espectáculo gratuito de tango en la calle, en las plazas de San Telmo.',
    en: 'Free street tango show in San Telmo plazas.',
    categories: ['arts'],
    when: ba(2026, 8, 15, 19, 0), // Sat Aug 15
    venue: area('San Telmo', 'Plazas de San Telmo'),
    is_free: true,
    facets: { genres: ['tango'], price: 'free' },
  }),
  ev({
    id: '00000000-0000-4000-8000-000000000017',
    name: 'Punk en vivo La Bartola',
    es: 'Gig punk con bandas locales en San Telmo, entrada a moderada.',
    en: 'Punk gig with local bands in San Telmo, moderate entry.',
    categories: ['music'],
    when: ba(2026, 8, 15, 21, 0), // Sat Aug 15
    venue: venue('cafeSanTelmo', 'La Bartola', 'San Telmo'),
    price: 10000,
    facets: { genres: ['punk'] },
  }),
  ev({
    id: '00000000-0000-4000-8000-000000000020',
    name: 'Día de Familia Gratis San Telmo',
    es: 'Jornada familiar gratuita en San Telmo con juegos y ferias de comida.',
    en: 'Free family day in San Telmo with games and food stalls.',
    categories: ['festival', 'food'],
    when: ba(2026, 8, 16, 15, 0), // Sun Aug 16
    venue: area('San Telmo', 'Plaza Dorrego'),
    is_free: true,
    facets: { price: 'free' },
  }),

  // --- reggaeton / "anything but" targets ---
  ev({
    id: '00000000-0000-4000-8000-000000000007',
    name: 'Perreo Palermo',
    es: 'Noche de reggaetón y baile a todo volumen en Palermo.',
    en: 'Loud reggaeton night with dancing in Palermo.',
    categories: ['music', 'social'],
    when: ba(2026, 8, 15, 22, 0), // Sat Aug 15
    venue: venue('warehouse', 'La Rural', 'Palermo'),
    price: 12000,
    facets: { genres: ['reggaeton'] },
  }),
  ev({
    id: '00000000-0000-4000-8000-000000000022',
    name: 'Reggaetón en el Centro',
    es: 'Baile de reggaetón en Monserrat, principalmente urbano.',
    en: 'Reggaeton dance party in Monserrat.',
    categories: ['music', 'social'],
    when: ba(2026, 8, 15, 23, 0), // Sat Aug 15
    venue: area('Monserrat', 'Espacio Monserrat'),
    price: 10000,
    facets: { genres: ['reggaeton'] },
  }),

  // --- chill / tranqui / composition ---
  ev({
    id: '00000000-0000-4000-8000-000000000013',
    name: 'Bar Tranqui Boedo',
    es: 'Bar tranqui en Boedo con música de fondo, ideal para hablar y tomar algo.',
    en: 'Chill Boedo bar with background music, great for conversation.',
    categories: ['social', 'music'],
    when: ba(2026, 8, 16, 20, 0), // Sun Aug 16
    venue: venue('boedoBar', 'Bar Tranqui Boedo', 'Boedo'),
    price: 8000,
    facets: { vibe: 'chill', canTalk: true },
  }),

  // --- surprise / location TBA ---
  ev({
    id: '00000000-0000-4000-8000-000000000011',
    name: 'Experiencia Sorpresa en Palermo',
    es: 'Evento sorpresa: la ubicación se revela al comprar la entrada. Asistí a una fiesta secreta.',
    en: 'Surprise experience in Palermo: location revealed on purchase. Secret party.',
    categories: ['social', 'festival'],
    when: ba(2026, 8, 15, 23, 0), // Sat Aug 15
    venue: area('Palermo', 'Ubicación secreta'),
    location_tba: true,
    is_free: true,
    facets: { surprising: true, location: 'tba' },
  }),

  // --- tomorrow (Fri Aug 14) ---
  ev({
    id: '00000000-0000-4000-8000-000000000024',
    name: 'Carrera Solidaria al Amanecer',
    es: 'Carrera solidaria de 10k en San Telmo el viernes por la mañana.',
    en: 'Sunrise charity 10k run in San Telmo on Friday morning.',
    categories: ['sports'],
    when: ba(2026, 8, 14, 9, 0), // Fri Aug 14 09:00 BA
    venue: area('San Telmo', 'Ruta San Telmo'),
    price: 5000,
    facets: { activity: 'running' },
  }),
  ev({
    id: '00000000-0000-4000-8000-000000000025',
    name: 'Cumbia Viernes en Niceto',
    es: 'Música cumbia y baile en Niceto el viernes a la noche.',
    en: 'Cumbia music and dancing at Niceto on Friday night.',
    categories: ['music'],
    when: ba(2026, 8, 14, 22, 0), // Fri Aug 14 22:00 BA
    venue: venue('niceto', 'Niceto Club', 'Palermo'),
    price: 14000,
    facets: { genres: ['cumbia'] },
  }),
  ev({
    id: '00000000-0000-4000-8000-000000000026',
    name: 'Brunch Caro San Telmo',
    es: 'Brunch premium en San Telmo con opciones gourmet y precio elevado.',
    en: 'Premium brunch in San Telmo with gourmet options and a high price.',
    categories: ['food'],
    when: ba(2026, 8, 14, 11, 0), // Fri Aug 14 11:00 BA
    venue: venue('cafeSanTelmo', 'Café San Telmo', 'San Telmo'),
    price: 30000,
    facets: { price: 'expensive' },
  }),

  // --- tonight (Thu Aug 13) ---
  ev({
    id: '00000000-0000-4000-8000-000000000023',
    name: 'Café Nocturno Gratis Palermo',
    es: 'Café y juegos de mesa gratuito esta noche en Palermo.',
    en: 'Free coffee and board games tonight in Palermo.',
    categories: ['social'],
    when: ba(2026, 8, 13, 20, 0), // Thu Aug 13 20:00 BA (tonight)
    venue: venue('tercerParque', 'Café Bar Palermo', 'Palermo'),
    is_free: true,
    facets: { price: 'free', vibe: 'chill' },
  }),
  ev({
    id: '00000000-0000-4000-8000-000000000018',
    name: 'Karting Nocturno Palermo',
    es: 'Carreras de karting bajo luces la noche del jueves en Palermo.',
    en: 'Floodlit go-karting Thursday night in Palermo.',
    categories: ['sports'],
    when: ba(2026, 8, 13, 21, 0), // Thu Aug 13 21:00 BA (tonight)
    venue: venue('tercerParque', 'Karting Palermo', 'Palermo'),
    price: 9000,
    facets: { activity: 'karting' },
  }),

  // --- near-midnight tonight (Fri Aug 14 01:00 BA, inside the tonight window) ---
  ev({
    id: '00000000-0000-4000-8000-000000000027',
    name: 'After Hours Silencio Palermo',
    es: "Sesión 'after hours' nocturna en Palermo pasada la medianoche, ambiente oscuro con deep house para los que recién llegan esta noche.",
    en: "Nocturnal 'after hours' session in Palermo after midnight, dark deep-house vibe for those just arriving tonight.",
    categories: ['music', 'social'],
    when: ba(2026, 8, 14, 1, 0), // Fri Aug 14 01:00 BA (tonight)
    venue: venue('boedoBar', 'Club Silencio', 'Palermo'),
    price: 7000,
    facets: { genres: ['deep-house'], vibe: 'dark' },
  }),
]

/**
 * The committed corpus file. `generatedAt` is a placeholder the snapshot
 * script overwrites; the fixture file keeps a stable date so labels never
 * drift.
 */
export function buildFixtureFile(): import('./types').CorpusFile {
  return {
    meta: {
      kind: 'fixture',
      generatedAt: '2026-08-01T00:00:00.000Z',
      source: 'evals/search/corpus/fixture.ts',
    },
    // Deterministic id-ordering (matches the live snapshot's sort in
    // scripts/snapshot-search-corpus.ts) so `events.json` is byte-stable and
    // the relevance runner's labels index predictably.
    events: [...FIXTURE_EVENTS].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  }
}

import { eventFacetsSchema } from '#shared/lib/search-facets.ts'
import { detectReplyLanguage } from '../concierge/language.ts'

export interface EnrichmentCase {
  id: string
  task: 'translation' | 'summary' | 'facets' | 'venue' | 'missing'
  source: string
  locale: 'en' | 'es'
  expected: {
    required?: string[][]
    forbidden?: string[]
    venue?: string | null
    empty?: boolean
    requiredFacets?: Record<string, string[]>
    requiredScalarFacets?: Record<string, string>
    allowedFacets?: Record<string, string[]>
  }
}

export const ENRICHMENT_CORPUS_VERSION = 'enrichment-source-controls-v2'
export const ENRICHMENT_CASES: EnrichmentCase[] = [
  { id: 'translation-es-en', task: 'translation', locale: 'en',
    source: 'Ada Ríos presenta 35 obras originales. La visita dura 45 minutos.\n\nNo incluye bebidas.',
    expected: { required: [['Ada'], ['35'], ['45'], ['no drinks', 'not include drinks', 'not included', 'does not include beverages']] } },
  { id: 'translation-en-es', task: 'translation', locale: 'es',
    source: 'Nora Vidal leads a workshop for 12 adults. Materials are included.\n\nNo prior experience is required.',
    expected: { required: [['Nora Vidal'], ['12'], ['materiales'], ['no se requiere', 'no requiere', 'no es necesaria', 'no es necesario']] } },
  { id: 'summary-en', task: 'summary', locale: 'en',
    source: 'An instrumental jazz trio performs original music in an intimate setting. Venue: Sala Prueba. Tickets cost 2500 pesos. Starts at 19:30.',
    expected: { required: [['jazz']], forbidden: ['Sala Prueba', '2500', '19:30', 'dinner', 'free drinks'] } },
  { id: 'summary-es', task: 'summary', locale: 'es',
    source: 'Taller de cerámica para principiantes, con modelado manual de piezas y materiales incluidos. Lugar: Centro Prueba. Entrada: 3500 pesos. Horario: 18:00.',
    expected: { required: [['cerámica', 'ceramica']], forbidden: ['Centro Prueba', '3500', '18:00', 'cena', 'vino'] } },
  { id: 'facets-jazz-en', task: 'facets', locale: 'en',
    source: 'An intimate, relaxed live jazz concert indoors with seated guests. The music is low-energy and guests listen with little social interaction.',
    expected: { requiredFacets: { eventType: ['concert'], genres: ['jazz'], activities: ['live-music'], setting: ['indoor', 'seated'] }, requiredScalarFacets: { energy: 'low', socialInteraction: 'low' },
      allowedFacets: { eventType: ['concert'], genres: ['jazz'], activities: ['live-music'], setting: ['indoor', 'seated'], vibes: ['intimate', 'relaxed'], audience: [], energy: ['low'], socialInteraction: ['low'] } } },
  { id: 'facets-tango-es', task: 'facets', locale: 'es',
    source: 'Clase de pasos de tango para principiantes en un salón interior. Cada persona practicará sola. La actividad es suave, de poca energía y con poca interacción social. No se describe ninguna otra característica.',
    expected: { requiredFacets: { eventType: ['class'], genres: ['tango'], activities: ['dancing'], setting: ['indoor'] }, requiredScalarFacets: { energy: 'low', socialInteraction: 'low' },
      allowedFacets: { eventType: ['class'], genres: ['tango'], activities: ['dancing', 'workshop'], setting: ['indoor'], vibes: ['relaxed'], audience: ['solo'], energy: ['low'], socialInteraction: ['low'] } } },
  { id: 'facets-no-romance-or-genre', task: 'facets', locale: 'en',
    source: 'This event is a dinner. No atmosphere, music genre, audience, seating, energy or social-interaction information is stated.',
    expected: { requiredFacets: { eventType: ['food'], activities: ['dinner'] },
      allowedFacets: { eventType: ['food'], genres: [], activities: ['dinner'], setting: [], vibes: [], audience: [], energy: [], socialInteraction: [] } } },
  { id: 'venue-en', task: 'venue', locale: 'en', source: 'Venue: Sala Prueba\nAddress: Calle Ejemplo 123, Buenos Aires.', expected: { venue: 'Sala Prueba' } },
  { id: 'venue-es', task: 'venue', locale: 'es', source: 'Lugar: Centro Cultural Prueba\nDirección: Calle Ficticia 456, CABA.', expected: { venue: 'Centro Cultural Prueba' } },
  { id: 'venue-address-only', task: 'venue', locale: 'es', source: 'Dirección: Calle Ficticia 456, CABA. No se publica un nombre de lugar.', expected: { venue: null } },
  { id: 'missing-description-en', task: 'missing', locale: 'en', source: 'Event E-42\nDate: 13 October 2026\nTickets: Register here\nTerms and privacy policy. No event description is available.', expected: { empty: true } },
  { id: 'missing-description-es', task: 'missing', locale: 'es', source: 'Evento E-43\nFecha: 13 de octubre de 2026\nEntradas: Registrarse\nTérminos y privacidad. No hay descripción del evento.', expected: { empty: true } },
]

/** Targeted source controls, not a complete semantic-fidelity or human-calibrated judge. */
export function scoreEnrichmentCase(test: EnrichmentCase, output: unknown): string[] {
  if (test.task === 'venue') return output === test.expected.venue ? [] : ['venue differs from the source label']
  if (test.expected.empty) return output === null || output === '' ? [] : ['missing-source result is not empty']
  if (test.task === 'facets') {
    const parsed = eventFacetsSchema.safeParse(output)
    if (!parsed.success) return ['invalid facet contract']
    const facets = parsed.data as unknown as Record<string, unknown>
    const failures: string[] = []
    for (const [key, expected] of Object.entries(test.expected.requiredScalarFacets ?? {})) if (facets[key] !== expected) failures.push(`missing scalar facet ${key}:${expected}`)
    for (const [key, expected] of Object.entries(test.expected.requiredFacets ?? {})) {
      const actual = Array.isArray(facets[key]) ? facets[key] as string[] : []
      for (const value of expected) if (!actual.includes(value)) failures.push(`missing facet ${key}:${value}`)
    }
    for (const [key, allowed] of Object.entries(test.expected.allowedFacets ?? {})) {
      const value = facets[key]
      const actual = Array.isArray(value) ? value : value === undefined ? [] : [value]
      if (actual.some(item => !allowed.includes(String(item)))) failures.push(`unsupported facet ${key}`)
    }
    return failures
  }
  if (typeof output !== 'string' || !output.trim()) return ['missing generated text']
  const normalized = output.toLocaleLowerCase()
  const numericTokens = new Set(output.match(/\d+(?:[.,]\d+)*/g) ?? [])
  const failures: string[] = []
  for (const alternatives of test.expected.required ?? []) if (!alternatives.some(term => /^\d+$/.test(term) ? numericTokens.has(term) : normalized.includes(term.toLocaleLowerCase()))) failures.push(`missing source control: ${alternatives.join(' / ')}`)
  for (const term of test.expected.forbidden ?? []) if (normalized.includes(term.toLocaleLowerCase())) failures.push(`forbidden source control: ${term}`)
  if (detectReplyLanguage(output) !== test.locale) failures.push('wrong or unmeasured output language')
  if (test.task === 'summary' && (output.length > 180 || /\d/.test(output))) failures.push('summary contains structured details or exceeds its length bound')
  if (test.task === 'translation' && output.trim().split(/\n\s*\n/).length !== test.source.trim().split(/\n\s*\n/).length) failures.push('translation changed paragraph structure')
  return failures
}

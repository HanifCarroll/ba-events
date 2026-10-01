/**
 * Passline API Client
 *
 * Fetches events from Passline's public API.
 * API discovered via browser network inspection - no official documentation.
 */

import { isBlockedByEntries } from '../shared/blocklist-filter.ts'
import type { ImportBlocklistEntry } from '#shared/lib/types.ts'
import { Schema } from 'effect'

// Passline event structure from their API
export interface PasslineEvent {
  id: string
  nombre: string
  lugar: string
  fecha_inicio: string // "YYYY-MM-DD"
  fecha_termino: string // "YYYY-MM-DD"
  hora_inicio: string // "HH:mm:ss"
  hora_termino: string // "HH:mm:ss"
  nombre_region: string // "Capital Federal" for CABA
  nombre_communa: string // "C.A.B.A.", etc.
  category_name: string
  artistas: string // Comma-separated
  precio_min: string | null
  url: string
  miniatura: string
  recorte: string // Main image
  slug: string
  agotado: string // "0" or "1" - sold out
  disponibles: string // Available tickets
  promocion: string
}

const passlineEventSchema = Schema.Struct({
  id: Schema.String,
  nombre: Schema.String,
  lugar: Schema.String,
  fecha_inicio: Schema.String,
  fecha_termino: Schema.String,
  hora_inicio: Schema.String,
  hora_termino: Schema.String,
  nombre_region: Schema.String,
  nombre_communa: Schema.String,
  category_name: Schema.String,
  artistas: Schema.String,
  precio_min: Schema.NullOr(Schema.String),
  url: Schema.String,
  miniatura: Schema.String,
  recorte: Schema.String,
  slug: Schema.String,
  agotado: Schema.String,
  disponibles: Schema.String,
  promocion: Schema.String,
})
const passlineResponseSchema = Schema.Struct({
  BillboardByCountry: Schema.Array(passlineEventSchema),
})

class PasslineApiError extends Error {
  readonly _tag = 'PasslineApiError'
}

export function parsePasslineApiResponse(input: unknown): PasslineEvent[] | null {
  const parsed = Schema.decodeUnknownResult(passlineResponseSchema)(input)
  return parsed._tag === 'Success'
    ? parsed.success.BillboardByCountry.map((event) => event as unknown as PasslineEvent)
    : null
}

export const PASSLINE_API_URL = 'https://api.passline.com/v1/event/GetBillboardByCountry'
export const PASSLINE_PAGE_SIZE = 200

/** Empty terminal page proves exhaustion; a short page alone does not. */
export async function collectPasslinePages(
  readPage: (offset: number, size: number) => Promise<unknown>,
  maxPages = 500
): Promise<PasslineEvent[]> {
  const byId = new Map<string, PasslineEvent>()
  let offset = 0
  for (let page = 0; page < maxPages; page++) {
    const raw = await readPage(offset, PASSLINE_PAGE_SIZE)
    const events = parsePasslineApiResponse({ BillboardByCountry: raw })
    if (!events) throw new PasslineApiError(`Malformed Passline page at offset ${offset}`)
    if (!events.length) {
      console.info('[passline] Complete country acquisition', { pages: page + 1, rawRows: offset, distinctIds: byId.size })
      return [...byId.values()]
    }
    for (const event of events) {
      const existing = byId.get(event.id)
      if (existing && JSON.stringify(existing) !== JSON.stringify(event)) {
        throw new PasslineApiError(`Conflicting Passline identity during pagination: ${event.id}`)
      }
      byId.set(event.id, event)
    }
    offset += events.length
  }
  throw new PasslineApiError('Passline pagination exhausted its safety bound before an empty terminal page')
}

export async function fetchPasslineEvents(): Promise<PasslineEvent[]> {
  return collectPasslinePages(async (offset, size) => {
    const response = await fetch(PASSLINE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ country: 'argentina', limit: `${offset},${size}` }),
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new PasslineApiError(`Passline API error: ${response.status}`)
    return response.json() as Promise<unknown>
  })
}

/**
 * Filter events to only include CABA (Capital Federal) events
 * Also excludes "VARIAS LOCACIONES" which are venue rental ads, not real events
 * Also applies the blocklist to filter out advertisement events
 *
 * @param events - Events to filter
 * @param blocklistEntries - Optional blocklist entries from database
 */
export function filterCABAEvents(
  events: PasslineEvent[],
  blocklistEntries?: ImportBlocklistEntry[]
): PasslineEvent[] {
  return events
    .filter((e) => e.nombre_region === 'Capital Federal' && e.lugar !== 'VARIAS LOCACIONES')
    .filter((e) => !blocklistEntries?.length || !isBlockedByEntries(e.nombre, e.lugar, blocklistEntries))
}

/**
 * Check if an event is sold out
 */
export function isSoldOut(event: PasslineEvent): boolean {
  return event.agotado === '1'
}

/**
 * Date range for filtering events
 */
export interface DateRange {
  startDate: string // "YYYY-MM-DD"
  endDate: string // "YYYY-MM-DD"
}

/**
 * Filter events by date range
 * Uses fecha_inicio (start date) for filtering
 */
export function filterByDateRange(
  events: PasslineEvent[],
  dateRange: DateRange
): PasslineEvent[] {
  return events.filter((event) => {
    const eventDate = event.fecha_inicio // Already "YYYY-MM-DD" format
    return eventDate >= dateRange.startDate && eventDate <= dateRange.endDate
  })
}

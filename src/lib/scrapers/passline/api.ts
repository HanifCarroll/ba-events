/**
 * Passline API Client
 *
 * Fetches events from Passline's public API.
 * API discovered via browser network inspection - no official documentation.
 */

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

interface PasslineAPIResponse {
  BillboardByCountry: PasslineEvent[]
}

const PASSLINE_API_URL =
  'https://api.passline.com/v1/event/GetCountryByBillboardHome'

/**
 * Fetch all events from Passline for Argentina
 */
export async function fetchPasslineEvents(): Promise<PasslineEvent[]> {
  const response = await fetch(PASSLINE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ country: 'argentina' }),
  })

  if (!response.ok) {
    throw new Error(`Passline API error: ${response.status} ${response.statusText}`)
  }

  const data: PasslineAPIResponse = await response.json()
  return data.BillboardByCountry || []
}

/**
 * Filter events to only include CABA (Capital Federal) events
 */
export function filterCABAEvents(events: PasslineEvent[]): PasslineEvent[] {
  return events.filter((e) => e.nombre_region === 'Capital Federal')
}

/**
 * Check if an event is sold out
 */
export function isSoldOut(event: PasslineEvent): boolean {
  return event.agotado === '1'
}

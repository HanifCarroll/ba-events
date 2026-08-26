import { z } from 'zod'
import { CATEGORIES, NEIGHBORHOODS, type PublicEventRecord } from '#shared/lib/types.ts'

const boundedText = (max: number) => z.string().trim().min(1).max(max)
const boundedList = z.array(boundedText(80)).max(20)
const isoDate = z.string().refine(
  (value) => /^(\d{4}-\d{2}-\d{2})(?:T|$)/.test(value) && Number.isFinite(Date.parse(value)),
  'Must be an ISO date',
)

/** Public MCP input: deliberately excludes internal venue database ids. */
export const publicSearchInputSchema = z.object({
  query: boundedText(500).optional(),
  categories: z.array(z.enum(CATEGORIES)).max(CATEGORIES.length).optional(),
  neighborhoods: z.array(z.enum(NEIGHBORHOODS)).max(NEIGHBORHOODS.length).optional(),
  venueName: boundedText(160).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  isFree: z.boolean().optional(),
  maxPrice: z.number().finite().nonnegative().max(10_000_000).optional(),
  minAge: z.number().int().min(0).max(99).optional(),
  timeFilter: z.enum(['now', 'tonight', 'tomorrow', 'weekend', 'week', 'future']).optional(),
  avoid: boundedList.optional(),
  objective: z.enum(['search', 'surprise']).optional(),
  limit: z.number().int().min(1).max(5).optional(),
}).strict().refine(
  (value) => !value.dateFrom || !value.dateTo || Date.parse(value.dateFrom) <= Date.parse(value.dateTo),
  { message: 'dateFrom must not be after dateTo' },
)

export type PublicSearchInput = z.infer<typeof publicSearchInputSchema>

export type PublicEvent = {
  id: string
  url: string
  name: string
  description: string | null
  startsAt: string
  endsAt: string | null
  isAllDay: boolean
  timeTba: boolean
  categories: string[]
  price: number | null
  isFree: boolean
  minAge: number | null
  imageUrl: string | null
  sourceUrl: string | null
  ticketUrl: string | null
  venue: {
    name: string | null
    neighborhood: string | null
    address?: string | null
  }
}

export type PublicToolOutput = {
  events: PublicEvent[]
  count: number
  note?: string
  error?: string
}

function publicDescription(event: PublicEventRecord): string | null {
  const description = event.description_summary_es || event.description_summary_en || event.description_display_es || event.description_display_en
  return description?.slice(0, 2_000) ?? null
}

/** Whitelist mapper. Event fields are untrusted content, never instructions. */
export function toPublicEvent(event: PublicEventRecord): PublicEvent {
  const venue = {
    name: event.venue_name,
    neighborhood: event.venue_neighborhood,
    ...(event.location_hidden ? {} : { address: event.venue_address }),
  }
  return {
    id: event.id,
    url: `https://baeventos.com/events/${encodeURIComponent(event.id)}`,
    name: event.name,
    description: publicDescription(event),
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    isAllDay: event.is_all_day,
    timeTba: event.time_tba,
    categories: event.categories,
    price: event.price,
    isFree: event.is_free,
    minAge: event.min_age,
    imageUrl: event.image_url,
    sourceUrl: event.link,
    ticketUrl: event.ticket_url,
    venue,
  }
}

export function publicOutput(events: PublicEventRecord[], error?: string, note?: string): PublicToolOutput {
  return { events: events.map(toPublicEvent), count: events.length, ...(note ? { note } : {}), ...(error ? { error } : {}) }
}

export const publicOutputSchema = z.object({
  events: z.array(z.object({
    id: z.string().uuid(), url: z.string().url(), name: z.string().max(500), description: z.string().max(2_000).nullable(),
    startsAt: z.string(), endsAt: z.string().nullable(), isAllDay: z.boolean(), timeTba: z.boolean(),
    categories: z.array(z.string()), price: z.number().nullable(), isFree: z.boolean(), minAge: z.number().nullable(),
    imageUrl: z.string().url().nullable(), sourceUrl: z.string().url().nullable(), ticketUrl: z.string().url().nullable(),
    venue: z.object({ name: z.string().nullable(), neighborhood: z.string().nullable(), address: z.string().nullable().optional() }),
  })),
  count: z.number().int().nonnegative(),
  note: z.string().max(500).optional(),
  error: z.string().optional(),
})

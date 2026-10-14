import { createHash } from 'node:crypto'
import { toZonedTime } from 'date-fns-tz'
import type { ChatEventPayload, Neighborhood } from '#shared/lib/types.ts'
import { parseEventFacets, type EventFacetGenre } from '#shared/lib/search-facets.ts'
import type { SharedChatTurnDependencies } from '#features/chat/api/agent/shared-turn.server.ts'
import { orchestrate, runToolLoop, type AgentInput, type AgentRun, type AgentRunner, type RawToolOutput, type ReadExecutors } from '#features/chat/api/agent/orchestrate.ts'
import { canonicalizeSearchIntent, type CanonicalizeInput, type EventSearchIntent } from '#features/chat/api/tools/search-intent.ts'
import { applyDiversity, surpriseRank } from '#features/chat/api/tools/search-ranking.ts'
import { searchRetryBoundary, widenedSearchConstraints, rejectedSearchRetry } from '#features/chat/api/tools/search-retry.ts'

export const CORPUS_VERSION = 'concierge-synthetic-v1'
export const FROZEN_NOW = '2026-10-13T15:00:00-03:00'
export const FROZEN_DATE = '2026-10-13'

function event(index: number, name: string, description: string | null,
  neighborhood: Neighborhood, price: number, startsAt: string, genres: EventFacetGenre[], venueName?: string,
): ChatEventPayload {
  const id = `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`
  return {
    id, name, description_en: description, description_es: description,
    description_display_en: description, description_display_es: description,
    description_summary_en: description, description_summary_es: description,
    starts_at: startsAt, ends_at: null, is_all_day: false, time_tba: false,
    venue_id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    venue_name: venueName ?? `Sala de prueba ${index}`, venue_neighborhood: neighborhood,
    venue_address: `Calle de prueba ${index * 100}`, categories: ['Music'],
    price, is_free: price === 0, min_age: 18, image_url: null,
    link: `https://example.test/events/${index}`, ticket_url: null, source: 'eval-fixture',
    external_id: `synthetic-${index}`, status: 'scheduled', location_hidden: false,
    location_tba: false, description_unavailable: description === null,
    enrichment_status: 'completed', enrichment_error: null, enriched_at: null,
    facets: parseEventFacets({ genres }), created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  }
}

// Synthetic source facts: none of these records describes a real advertised event.
const EVENTS = [
  event(1, 'Trío de jazz del martes', 'An acoustic jazz trio performs original instrumental music. Un trío de jazz acústico toca música instrumental.', 'Palermo', 0, '2026-10-14T00:00:00Z', ['jazz']),
  event(2, 'Milonga del patio', 'An open-air tango dance with live musicians. Una milonga al aire libre con músicos en vivo.', 'Palermo', 0, '2026-10-14T01:00:00Z', ['tango']),
  event(3, 'Canciones junto al jardín', 'A singer performs acoustic folk songs. Una cantante interpreta canciones de folk acústico.', 'Palermo', 0, '2026-10-14T02:00:00Z', ['folk']),
  event(4, 'Noche electrónica', 'A ticketed techno DJ performance indoors. Una noche de techno con entrada paga.', 'Palermo', 12000, '2026-10-14T03:00:00Z', ['techno', 'electronic']),
  event(5, 'Jazz del mercado', 'A jazz quartet performs instrumental standards. Un cuarteto de jazz interpreta clásicos instrumentales.', 'San Telmo', 0, '2026-10-14T00:30:00Z', ['jazz']),
  event(6, 'Guitarras de San Telmo', 'Two guitarists perform acoustic folk music. Dos guitarristas tocan folk acústico.', 'San Telmo', 0, '2026-10-14T01:30:00Z', ['folk']),
  event(7, 'Tango de la plaza', 'A tango orchestra performs a concert with seating. Una orquesta de tango ofrece un concierto con asientos.', 'San Telmo', 0, '2026-10-14T02:30:00Z', ['tango']),
  event(8, 'Jazz de mañana', 'An acoustic jazz concert on Wednesday evening. Un concierto de jazz acústico el miércoles a la noche.', 'Palermo', 0, '2026-10-15T00:00:00Z', ['jazz']),
  event(9, 'Encuentro sin descripción', null, 'Villa Crespo', 0, '2026-10-14T00:00:00Z', ['jazz'], 'Casa SinTexto'),
]

export const CORPUS_HASH = createHash('sha256').update(JSON.stringify({
  version: CORPUS_VERSION, now: FROZEN_NOW, events: EVENTS,
})).digest('hex')

export function frozenEvents(): ChatEventPayload[] { return structuredClone(EVENTS) }

/** Reuse production intent/date rules with a fixture-only venue resolver. */
export async function frozenSearchIntent(input: CanonicalizeInput, corpus: readonly ChatEventPayload[] = EVENTS): Promise<EventSearchIntent> {
  const venueIds = input.venueName
    ? corpus.filter(item => item.venue_name?.toLocaleLowerCase() === input.venueName!.toLocaleLowerCase()).map(item => item.venue_id!)
    : input.venueIds
  const intent = await canonicalizeSearchIntent({ ...input, venueName: undefined, venueIds },
    toZonedTime(new Date(FROZEN_NOW), 'America/Argentina/Buenos_Aires'))
  if (input.venueName) intent.must.venueIds = venueIds ?? []
  return intent
}

function matches(event: ChatEventPayload, intent: EventSearchIntent, happeningNow: boolean): boolean {
  const must = intent.must
  const timestamp = Date.parse(event.starts_at)
  const within = (after?: string, before?: string) =>
    (!after || timestamp >= Date.parse(after)) && (!before || timestamp < Date.parse(before))
  return event.status === 'scheduled'
    && (happeningNow ? timestamp <= Date.parse(FROZEN_NOW) && !!event.ends_at && Date.parse(event.ends_at) > Date.parse(FROZEN_NOW) : timestamp >= Date.parse(FROZEN_NOW))
    && within(must.startsAfter, must.startsBefore)
    && (!must.weekdayWindows || must.weekdayWindows.some(window => within(window.startsAfter, window.startsBefore)))
    && (!must.neighborhoodIds || must.neighborhoodIds.includes(event.venue_neighborhood!))
    && (!must.venueIds || must.venueIds.includes(event.venue_id!))
    && (!must.categories || must.categories.some(category => event.categories.includes(category)))
    && (must.isFree !== true || event.is_free)
    && (must.maxPrice === undefined || (event.price !== null && event.price <= must.maxPrice))
    && (must.attendeeAge === undefined || event.min_age === null || event.min_age <= must.attendeeAge)
    && !(intent.avoid.genres ?? []).some(genre => event.facets.genres?.some(value => value === genre))
}

export function frozenReadExecutors(corpus: readonly ChatEventPayload[] = frozenEvents()): Required<ReadExecutors> {
  // Every read is supplied. There is no fallback to a live database or reranker.
  const rows = structuredClone(corpus)
  const okEvents = (events: ChatEventPayload[], metadata?: Record<string, unknown>): RawToolOutput =>
    ({ success: true, events: structuredClone(events), formatted: '', metadata })
  const missing = (): RawToolOutput => ({ success: false, formatted: '', error: 'not_found' })
  return {
    search: async (input, context) => {
      const intent = await frozenSearchIntent(input, rows)
      const boundary = searchRetryBoundary(intent, input)
      const widened = widenedSearchConstraints(context.searchRetryBoundary, boundary)
      if (widened.length) return rejectedSearchRetry(widened)
      let candidates = rows.filter(row => matches(row, intent, input.timeFilter === 'now'))
      const namedGenres = intent.queryGenres ?? []
      const genreMatches = candidates.filter(row => namedGenres.some(genre => row.facets.genres?.some(value => value === genre)))
      if (genreMatches.length) candidates = genreMatches
      // Fixed preference ranking replaces external retrieval, not the production planner.
      const score = (row: ChatEventPayload) => (intent.prefer.genres ?? []).filter(genre => row.facets.genres?.some(value => value === genre)).length
      candidates.sort((left, right) => score(right) - score(left) || left.starts_at.localeCompare(right.starts_at) || left.id.localeCompare(right.id))
      const events = intent.objective === 'surprise'
        ? surpriseRank(candidates, Date.parse(FROZEN_NOW)).slice(0, 1)
        : applyDiversity(candidates, intent.displayLimit)
      return { ...okEvents(events, { toolInput: input, zeroResults: !events.length, resultCount: events.length,
        coverage: { searchedFrom: intent.must.startsAfter ?? null, searchedTo: intent.must.startsBefore ?? null,
          searchedWindows: intent.must.weekdayWindows ?? null, totalMatches: candidates.length,
          returned: events.length, maxEventDate: rows.reduce((latest, row) => row.starts_at > latest ? row.starts_at : latest, '') } }), searchRetryBoundary: boundary }
    },
    eventDetails: async input => {
      const row = rows.find(row => row.id === input.eventId)
      return row ? okEvents([row]) : missing()
    },
    directions: async input => {
      const row = rows.find(row => input.eventId ? row.id === input.eventId : row.venue_id === input.venueId)
      if (!row) return missing()
      const address = `${row.venue_address}, ${row.venue_neighborhood}`
      return { success: true, formatted: '', directions: { eventId: row.id, venueId: row.venue_id!,
        eventName: row.name, venueName: row.venue_name!, address,
        mapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${row.venue_name}, ${address}, Buenos Aires, Argentina`)}` } }
    },
    venueDetails: async input => {
      const row = rows.find(row => input.venueId ? row.venue_id === input.venueId : row.venue_name === input.venueName)
      return row ? { success: true, formatted: '', venue: { venueId: row.venue_id!, venueName: row.venue_name!,
        address: row.venue_address, neighborhood: row.venue_neighborhood, website: null, instagram: null } } : missing()
    },
    listSaved: async () => ({ success: false, formatted: '', error: 'authentication_required' }),
  }
}

export function frozenDependencies(runAgentFn?: AgentRunner, observeRun?: (input: AgentInput, run: AgentRun) => void,
  corpus: readonly ChatEventPayload[] = frozenEvents()): SharedChatTurnDependencies {
  const rows = structuredClone(corpus)
  const readExecutors = frozenReadExecutors(rows)
  return {
    currentDateInBA: FROZEN_DATE,
    fetchEventFacts: async ids => rows.filter(row => ids.includes(row.id)).map(row => ({
      id: row.id, name: row.name, venue_id: row.venue_id, venue_name: row.venue_name, status: row.status,
    })),
    getSavedMembership: async () => ({ status: 'unavailable' }),
    orchestrateFn: input => orchestrate({ ...input, readExecutors,
      ...(observeRun ? { runAgentFn: async (agentInput: AgentInput) => {
        const run = await (runAgentFn ?? runToolLoop)(agentInput)
        observeRun(agentInput, run)
        return run
      } } : runAgentFn ? { runAgentFn } : {}),
    }),
  }
}

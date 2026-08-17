import type { ChatEventPayload } from '#shared/lib/types.ts'
import { Ledger, emptyEntry, type LedgerEntry } from './ledger.ts'

export function event(id: string, name: string): ChatEventPayload {
  return {
    id,
    name,
    categories: [],
    venue_neighborhood: null,
    price: null,
    is_free: false,
  } as unknown as ChatEventPayload
}

export function searchEntry(opts: {
  stepIndex?: number
  callIndex?: number
  toolCallId?: string
  events?: ChatEventPayload[]
  limit?: number
  objective?: 'search' | 'surprise'
  success?: boolean
}): LedgerEntry {
  const events = opts.events ?? []
  return emptyEntry({
    requestId: 'req-1',
    stepIndex: opts.stepIndex ?? 0,
    callIndex: opts.callIndex ?? 0,
    toolCallId: opts.toolCallId ?? `call-${opts.stepIndex ?? 0}-${opts.callIndex ?? 0}`,
    toolName: 'search_events',
    success: opts.success ?? true,
    kind: 'search',
    events,
    count: events.length,
    coverage: { searchedTo: null, maxEventDate: null },
    searchInput: {
      query: 'x',
      limit: opts.limit ?? 1,
      objective: opts.objective,
    },
    displayLimit: opts.limit ?? 1,
    searchMode: null,
    eventIds: events.map((e) => e.id),
    zeroResults: events.length === 0,
    error: null,
  })
}

export function mutationEntry(opts: {
  stepIndex?: number
  callIndex?: number
  toolCallId: string
  toolName: 'save_event' | 'unsave_event'
  eventId: string
  outcome: import('#shared/lib/types.ts').MutationOutcome
  message?: string
}): LedgerEntry {
  return emptyEntry({
    requestId: 'req-1',
    stepIndex: opts.stepIndex ?? 0,
    callIndex: opts.callIndex ?? 0,
    toolCallId: opts.toolCallId,
    toolName: opts.toolName,
    success: opts.outcome === 'applied' || opts.outcome === 'already_applied',
    kind: 'mutation',
    receipt: {
      toolCallId: opts.toolCallId,
      toolName: opts.toolName,
      eventId: opts.eventId,
      outcome: opts.outcome,
      message: opts.message ?? 'saved',
    },
    error: null,
  })
}

export function directionsEntry(opts: {
  toolCallId: string
  venueName?: string
  stepIndex?: number
  callIndex?: number
}): LedgerEntry {
  return emptyEntry({
    requestId: 'req-1',
    stepIndex: opts.stepIndex ?? 0,
    callIndex: opts.callIndex ?? 0,
    toolCallId: opts.toolCallId,
    toolName: 'get_directions',
    success: true,
    kind: 'directions',
    directions: {
      venueName: opts.venueName ?? 'Niceto',
      address: 'Niceto Vega 5510',
      mapsUrl: 'https://maps',
    },
    error: null,
  })
}

export function eventDetailsEntry(opts: {
  toolCallId: string
  eventId: string
  name: string
  stepIndex?: number
  callIndex?: number
}): LedgerEntry {
  return emptyEntry({
    requestId: 'req-1',
    stepIndex: opts.stepIndex ?? 0,
    callIndex: opts.callIndex ?? 0,
    toolCallId: opts.toolCallId,
    toolName: 'get_event_details',
    success: true,
    kind: 'event-details',
    events: [event(opts.eventId, opts.name)],
    eventIds: [opts.eventId],
    error: null,
  })
}

export function savedEventsEntry(opts: {
  toolCallId: string
  events?: ChatEventPayload[]
  stepIndex?: number
  callIndex?: number
}): LedgerEntry {
  const events = opts.events ?? []
  return emptyEntry({
    requestId: 'req-1',
    stepIndex: opts.stepIndex ?? 0,
    callIndex: opts.callIndex ?? 0,
    toolCallId: opts.toolCallId,
    toolName: 'list_saved_events',
    success: true,
    kind: 'saved-events',
    events,
    eventIds: events.map((e) => e.id),
    count: events.length,
    error: null,
  })
}

export function venueDetailsEntry(opts: {
  toolCallId: string
  venueName?: string
  stepIndex?: number
  callIndex?: number
}): LedgerEntry {
  return emptyEntry({
    requestId: 'req-1',
    stepIndex: opts.stepIndex ?? 0,
    callIndex: opts.callIndex ?? 0,
    toolCallId: opts.toolCallId,
    toolName: 'get_venue_details',
    success: true,
    kind: 'venue-details',
    venue: {
      venueId: null,
      venueName: opts.venueName ?? 'Niceto',
      neighborhood: 'Palermo',
      address: 'Niceto Vega 5510',
      website: 'https://niceto.com',
      instagram: null,
    },
    error: null,
  })
}

export function ledgerFrom(entries: LedgerEntry[]): Ledger {
  const ledger = new Ledger()
  for (const e of entries) ledger.push(e)
  return ledger
}

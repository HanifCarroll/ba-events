/**
 * Deterministic turn executor (v5 replacement).
 *
 * Takes a validated `TurnPlan` from the planner and executes it directly:
 * one search and at most one follow-up read, one saved-events read, or one
 * prior/pinned read. It calls the existing tool implementations
 * (`search-events.ts`, `get-event-details.ts`, `get-directions.ts`,
 * `get-venue-details.ts`, `list-saved-events.ts`) directly — never through the
 * AI SDK tool wrapper — and builds the `CanonicalChatResponse` server-side.
 *
 * There are ZERO mutation calls: save/unsave requests become
 * `show_for_save`/`show_for_unsave`, which return the exact event card plus a
 * deterministic message pointing at the card's own Save/Unsave control.
 * Handles and current-search `resultIndex` are validated exactly against the
 * rehydrated prior map and the actual ordered result list; an invalid handle or
 * index fails closed to a deterministic clarification/error.
 */

import type {
  CanonicalChatEventPayload,
  CanonicalChatResponse,
  CanonicalProvenance,
  ChatEventPayload,
  ClarificationKey,
  DirectionsData,
  MessageKey,
  SavedState,
  VenueDetailsData,
} from '#shared/lib/types.ts'
import { CHAT_CONTRACT_VERSION } from '#shared/lib/types.ts'
import type { ToolExecutionContext } from '../tools/types.ts'
import type { SearchEventsInput } from '../tools/search-events.ts'
import type { GetEventDetailsInput } from '../tools/get-event-details.ts'
import type { GetDirectionsInput } from '../tools/get-directions.ts'
import type { GetVenueDetailsInput } from '../tools/get-venue-details.ts'
import type { ListSavedEventsInput } from '../tools/list-saved-events.ts'
import type { EventWithVenue } from '#shared/lib/types.ts'
import { generateSuggestions } from '../suggestions.ts'
import {
  materializeText,
  materializeClarificationQuestions,
  materializeClarificationText,
} from './materialize.ts'
import { buildSanitizedTrace, type RawStep } from './trace.ts'
import type { FollowUpAction, TurnPlan } from './planner.ts'

export interface PriorResolvedEvent {
  eventId: string
  venueId: string | null
  venueName: string | null
  name: string
  saved: SavedState
}

/** The exact slice of a tool result the executor consumes (never prose). */
export interface ToolResult {
  success: boolean
  events?: ChatEventPayload[]
  directions?: DirectionsData | null
  venue?: VenueDetailsData | null
  error?: string
  metadata?: Record<string, unknown>
}

export interface ExecutorTools {
  search: (input: SearchEventsInput, ctx: ToolExecutionContext) => Promise<ToolResult>
  eventDetails: (input: GetEventDetailsInput, ctx: ToolExecutionContext) => Promise<ToolResult>
  directions: (input: GetDirectionsInput, ctx: ToolExecutionContext) => Promise<ToolResult>
  venueDetails: (input: GetVenueDetailsInput, ctx: ToolExecutionContext) => Promise<ToolResult>
  listSaved: (input: ListSavedEventsInput, ctx: ToolExecutionContext) => Promise<ToolResult>
}

export interface ExecutorInput {
  plan: TurnPlan
  requestId: string
  locale: 'en' | 'es'
  originalQuery: string
  ctx: ToolExecutionContext
  /** Exact server-owned handle map (handle -> rehydrated prior event). */
  prior: Map<string, PriorResolvedEvent>
  pinnedEventId?: string
  pinnedVenueId?: string | null
  pinnedVenueName?: string | null
  tools: ExecutorTools
}

export interface ExecutorResult {
  canonical: CanonicalChatResponse
  executionTrace: ReturnType<typeof buildSanitizedTrace>
  /** The reads actually performed, in order (for telemetry/evals). */
  reads: ReadonlyArray<ReadSummary>
}

/** A minimal, deterministic read summary (no raw reasoning/prose). */
export interface ReadSummary {
  toolCallId: string
  toolName: string
  input: unknown
  success: boolean
  /** Event ids this read produced (for grounding checks). */
  eventIds: string[]
}

interface ExecutedRead {
  toolCallId: string
  toolName: string
  input: unknown
  output: unknown
  success: boolean
  eventIds: string[]
}

function provenance(): CanonicalProvenance {
  return {
    sourceToolCallIds: [],
    directionToolCallIds: [],
    venueToolCallIds: [],
    mutationToolCallIds: [],
    suggestionToolCallIds: [],
    emptySourceToolCallIds: [],
    retainedSourceToolCallIds: [],
    stageIds: [],
    searchAttemptToolCallIds: [],
    searchIncomplete: false,
    origin: 'validated',
    fallbackUsed: false,
    fallbackReason: null,
  }
}

function baseCanonical(requestId: string): CanonicalChatResponse {
  return {
    contractVersion: CHAT_CONTRACT_VERSION,
    requestId,
    kind: 'error',
    messageKey: 'error',
    text: '',
    events: [],
    directions: null,
    venue: null,
    operations: [],
    suggestions: [],
    clarificationQuestions: [],
    provenance: provenance(),
  }
}

function savedById(prior: Map<string, PriorResolvedEvent>): Map<string, boolean> {
  const out = new Map<string, boolean>()
  for (const p of prior.values()) {
    if (typeof p.saved === 'boolean') out.set(p.eventId, p.saved)
  }
  return out
}

function stampSaved(event: ChatEventPayload, saved: SavedState): CanonicalChatEventPayload {
  return { ...event, saved }
}

function textFor(
  messageKey: MessageKey,
  locale: 'en' | 'es',
  events: CanonicalChatEventPayload[],
  directions: DirectionsData | null,
  venue: VenueDetailsData | null
): string {
  return materializeText({
    messageKey,
    locale,
    eventName: events[0]?.name,
    directionsVenueName: directions?.venueName,
    venueName: venue?.venueName,
  })
}

function setClarification(
  canonical: CanonicalChatResponse,
  key: ClarificationKey,
  locale: 'en' | 'es'
): void {
  const questions = materializeClarificationQuestions([key], locale)
  canonical.kind = 'clarification'
  canonical.messageKey = 'clarification'
  canonical.clarificationQuestions = questions
  canonical.text = materializeClarificationText(questions)
}

function buildTrace(reads: ExecutedRead[]): ReturnType<typeof buildSanitizedTrace> {
  const steps: RawStep[] = reads.map((r) => ({
    finishReason: 'tool-calls',
    toolCalls: [{ toolCallId: r.toolCallId, toolName: r.toolName, input: r.input }],
    toolResults: [
      { toolCallId: r.toolCallId, toolName: r.toolName, input: r.input, output: r.output },
    ],
  }))
  return buildSanitizedTrace(steps)
}

export async function runExecutor(input: ExecutorInput): Promise<ExecutorResult> {
  const { plan, requestId, locale, ctx, prior, tools } = input
  const reads: ExecutedRead[] = []
  const canonical = baseCanonical(requestId)
  const byId = savedById(prior)

  const record = (
    toolCallId: string,
    toolName: string,
    toolInput: unknown,
    output: unknown,
    success: boolean
  ) => {
    const eventIds = (
      (output as { events?: ChatEventPayload[] } | null | undefined)?.events ?? []
    ).map((e) => e.id)
    reads.push({ toolCallId, toolName, input: toolInput, output, success, eventIds })
  }

  const finish = (): ExecutorResult => ({
    canonical,
    executionTrace: buildTrace(reads),
    reads: reads.map((r) => ({
      toolCallId: r.toolCallId,
      toolName: r.toolName,
      input: r.input,
      success: r.success,
      eventIds: r.eventIds,
    })),
  })

  switch (plan.kind) {
    case 'clarification': {
      setClarification(canonical, plan.question, locale)
      return finish()
    }

    case 'out_of_scope': {
      canonical.kind = 'out_of_scope'
      canonical.messageKey = 'out_of_scope'
      canonical.text = materializeText({ messageKey: 'out_of_scope', locale })
      return finish()
    }

    case 'list_saved': {
      const savedToolCallId = `saved:${requestId}`
      const input: ListSavedEventsInput = { filter: plan.filter }
      const result = await tools.listSaved(input, ctx)
      record(savedToolCallId, 'list_saved_events', input, result, result.success)
      if (!result.success) {
        if (result.error === 'not_authenticated') {
          canonical.kind = 'saved_events'
          canonical.messageKey = 'login_required'
          canonical.text = materializeText({ messageKey: 'login_required', locale })
        } else {
          canonical.kind = 'error'
          canonical.messageKey = 'error'
          canonical.text = materializeText({ messageKey: 'error', locale })
        }
        return finish()
      }
      const events = (result.events ?? []).slice(0, 5).map((e) => stampSaved(e, true))
      if (events.length === 0) {
        canonical.kind = 'no_results'
        canonical.messageKey = 'no_results'
        canonical.text = materializeText({ messageKey: 'no_results', locale })
        canonical.provenance.emptySourceToolCallIds = [savedToolCallId]
      } else {
        canonical.kind = 'saved_events'
        canonical.messageKey = 'saved_events'
        canonical.events = events
        canonical.text = textFor('saved_events', locale, events, null, null)
        canonical.provenance.sourceToolCallIds = [savedToolCallId]
      }
      return finish()
    }

    case 'pinned_event_action': {
      if (!input.pinnedEventId) {
        setClarification(canonical, 'which_event', locale)
        return finish()
      }
      return runEventAction(plan.action, {
        eventId: input.pinnedEventId,
        venueId: input.pinnedVenueId ?? null,
        venueName: input.pinnedVenueName ?? null,
      })
    }

    case 'prior_event_action': {
      const resolved = prior.get(plan.targetHandle)
      if (!resolved) {
        setClarification(canonical, 'which_event', locale)
        return finish()
      }
      return runEventAction(plan.action, resolved)
    }

    case 'search': {
      const searchToolCallId = `search:${requestId}`
      const searchInput: SearchEventsInput = {
        ...plan.search,
        // An empty multi-result search must stay discovery, not the search
        // service's single-pick surprise default.
        ...(plan.count > 1 && !plan.search.objective ? { objective: 'search' as const } : {}),
        limit: plan.count,
      }
      const result = await tools.search(searchInput, ctx)
      record(searchToolCallId, 'search_events', searchInput, result, result.success)
      canonical.provenance.searchAttemptToolCallIds = [searchToolCallId]

      if (!result.success) {
        canonical.kind = 'error'
        canonical.messageKey = 'error'
        canonical.text = materializeText({ messageKey: 'error', locale })
        return finish()
      }

      const results = result.events ?? []

      if (plan.followUp) {
        const idx = plan.followUp.resultIndex
        if (idx < 0 || idx >= results.length) {
          setClarification(canonical, 'which_event', locale)
          return finish()
        }
        return runFollowUp(plan.followUp.action, results[idx], searchToolCallId)
      }

      if (results.length === 0) {
        canonical.kind = 'no_results'
        canonical.messageKey = 'no_results'
        canonical.text = materializeText({ messageKey: 'no_results', locale })
        canonical.provenance.emptySourceToolCallIds = [searchToolCallId]
        return finish()
      }

      const events = results.map((e) => stampSaved(e, byId.get(e.id) ?? null))
      canonical.kind = 'recommendations'
      canonical.messageKey =
        plan.count === 1 && plan.search.objective === 'surprise'
          ? 'recommendations_pick'
          : 'recommendations'
      canonical.events = events
      canonical.text = textFor(canonical.messageKey, locale, events, null, null)
      canonical.suggestions = generateSuggestions({
        originalQuery: input.originalQuery,
        toolInput: searchInput,
        results: events as unknown as EventWithVenue[],
        locale,
      })
      canonical.provenance.sourceToolCallIds = [searchToolCallId]
      canonical.provenance.suggestionToolCallIds = [searchToolCallId]
      return finish()
    }
  }

  // --- event-relative actions on a resolved prior/pinned target -------------

  async function runEventAction(
    action: FollowUpAction,
    target: { eventId: string; venueId: string | null; venueName?: string | null }
  ): Promise<ExecutorResult> {
    switch (action) {
      case 'event_details':
      case 'show_for_save':
      case 'show_for_unsave': {
        const detailsToolCallId = `details:${requestId}`
        const input: GetEventDetailsInput = { eventId: target.eventId }
        const result = await tools.eventDetails(input, ctx)
        record(detailsToolCallId, 'get_event_details', input, result, result.success)
        if (!result.success || !result.events || result.events.length === 0) {
          canonical.kind = 'error'
          canonical.messageKey = 'error'
          canonical.text = materializeText({ messageKey: 'error', locale })
          return finish()
        }
        canonical.events = [stampSaved(result.events[0], byId.get(target.eventId) ?? null)]
        canonical.kind = 'event_details'
        canonical.messageKey =
          action === 'show_for_save'
            ? 'use_save_control'
            : action === 'show_for_unsave'
              ? 'use_unsave_control'
              : 'event_details'
        canonical.text = textFor(canonical.messageKey, locale, canonical.events, null, null)
        canonical.provenance.sourceToolCallIds = [detailsToolCallId]
        return finish()
      }
      case 'directions': {
        const dirToolCallId = `directions:${requestId}`
        const input: GetDirectionsInput = target.eventId
          ? { eventId: target.eventId }
          : { venueId: target.venueId ?? undefined }
        const result = await tools.directions(input, ctx)
        record(dirToolCallId, 'get_directions', input, result, result.success)
        if (!result.success || !result.directions) {
          canonical.kind = 'error'
          canonical.messageKey = 'error'
          canonical.text = materializeText({ messageKey: 'error', locale })
          return finish()
        }
        canonical.kind = 'directions'
        canonical.messageKey = 'directions'
        canonical.directions = result.directions
        canonical.text = textFor('directions', locale, [], result.directions, null)
        canonical.provenance.directionToolCallIds = [dirToolCallId]
        return finish()
      }
      case 'venue_details': {
        const venueToolCallId = `venue:${requestId}`
        const venueInput: GetVenueDetailsInput | null = target.venueId
          ? { venueId: target.venueId }
          : target.venueName
            ? { venueName: target.venueName }
            : null
        if (!venueInput) {
          setClarification(canonical, 'which_venue', locale)
          return finish()
        }
        const result = await tools.venueDetails(venueInput, ctx)
        record(venueToolCallId, 'get_venue_details', venueInput, result, result.success)
        if (!result.success || !result.venue) {
          canonical.kind = 'error'
          canonical.messageKey = 'error'
          canonical.text = materializeText({ messageKey: 'error', locale })
          return finish()
        }
        canonical.kind = 'venue_details'
        canonical.messageKey = 'venue_details'
        canonical.venue = result.venue
        canonical.text = textFor('venue_details', locale, [], null, result.venue)
        canonical.provenance.venueToolCallIds = [venueToolCallId]
        return finish()
      }
    }
  }

  // A follow-up read on a current-search result (never re-enters the search path).
  async function runFollowUp(
    action: FollowUpAction,
    target: ChatEventPayload,
    searchToolCallId: string
  ): Promise<ExecutorResult> {
    const saved = byId.get(target.id) ?? null
    switch (action) {
      case 'show_for_save':
      case 'show_for_unsave': {
        canonical.events = [stampSaved(target, saved)]
        canonical.kind = 'event_details'
        canonical.messageKey = action === 'show_for_save' ? 'use_save_control' : 'use_unsave_control'
        canonical.text = textFor(canonical.messageKey, locale, canonical.events, null, null)
        canonical.provenance.sourceToolCallIds = [searchToolCallId]
        return finish()
      }
      case 'event_details': {
        const detailsToolCallId = `details:${requestId}`
        const input: GetEventDetailsInput = { eventId: target.id }
        const result = await tools.eventDetails(input, ctx)
        record(detailsToolCallId, 'get_event_details', input, result, result.success)
        if (!result.success || !result.events || result.events.length === 0) {
          canonical.kind = 'error'
          canonical.messageKey = 'error'
          canonical.text = materializeText({ messageKey: 'error', locale })
          return finish()
        }
        canonical.events = [stampSaved(result.events[0], saved)]
        canonical.kind = 'event_details'
        canonical.messageKey = 'event_details'
        canonical.text = textFor('event_details', locale, canonical.events, null, null)
        canonical.provenance.sourceToolCallIds = [detailsToolCallId]
        return finish()
      }
      case 'directions': {
        const dirToolCallId = `directions:${requestId}`
        const input: GetDirectionsInput = { eventId: target.id }
        const result = await tools.directions(input, ctx)
        record(dirToolCallId, 'get_directions', input, result, result.success)
        if (!result.success || !result.directions) {
          canonical.kind = 'error'
          canonical.messageKey = 'error'
          canonical.text = materializeText({ messageKey: 'error', locale })
          return finish()
        }
        canonical.kind = 'directions'
        canonical.messageKey = 'directions'
        canonical.directions = result.directions
        canonical.text = textFor('directions', locale, [], result.directions, null)
        canonical.provenance.directionToolCallIds = [dirToolCallId]
        return finish()
      }
      case 'venue_details': {
        const venueToolCallId = `venue:${requestId}`
        const venueInput: GetVenueDetailsInput | null = target.venue_id
          ? { venueId: target.venue_id }
          : target.venue_name
            ? { venueName: target.venue_name }
            : null
        if (!venueInput) {
          setClarification(canonical, 'which_venue', locale)
          return finish()
        }
        const result = await tools.venueDetails(venueInput, ctx)
        record(venueToolCallId, 'get_venue_details', venueInput, result, result.success)
        if (!result.success || !result.venue) {
          canonical.kind = 'error'
          canonical.messageKey = 'error'
          canonical.text = materializeText({ messageKey: 'error', locale })
          return finish()
        }
        canonical.kind = 'venue_details'
        canonical.messageKey = 'venue_details'
        canonical.venue = result.venue
        canonical.text = textFor('venue_details', locale, [], null, result.venue)
        canonical.provenance.venueToolCallIds = [venueToolCallId]
        return finish()
      }
    }
  }
}

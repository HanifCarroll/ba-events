/**
 * Convert a single tool execution into a typed ledger entry.
 *
 * Joins the tool call to its result by toolCallId and normalizes each tool's
 * output into the artifact payload the validator/fallback/finalizer consume.
 * Tool output is UNTRUSTED (model-navigable) — only structured fields are
 * trusted, and the mutation receipt is re-derived deterministically here.
 *
 * v4: mutation receipts come from structured tool/output fields only (the
 * deterministic localized table) — never from `formatted` prose. `check_event_saved`
 * becomes a typed `{eventId, isSaved}` artifact, and `retain_search_results` is
 * recorded structurally (its validated earlier source ids), never parsed from text.
 */

import type {
  ChatEventPayload,
  DirectionsData,
  MutationOutcome,
  OperationReceipt,
  SavedState,
  VenueDetailsData,
} from '#shared/lib/types.ts'
import type { CoverageInfo } from '../tools/coverage-guard.ts'
import type { SearchEventsInput } from '../tools/search-events.ts'
import { emptyEntry, type Ledger, type LedgerArtifactKind, type LedgerEntry, type CheckSavedState } from './ledger.ts'

export type ToolOutput = Record<string, unknown>

export interface RecordedToolResult {
  toolCallId: string
  toolName: string
  input: unknown
  output: ToolOutput
  startedAt: string
  completedAt: string
  success: boolean
}

function asEvents(output: ToolOutput): ChatEventPayload[] {
  const events = output.events
  if (!Array.isArray(events)) return []
  return events.filter(
    (e): e is ChatEventPayload =>
      !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string'
  )
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asCoverage(output: ToolOutput): CoverageInfo | null {
  const metadata = output.metadata
  if (!metadata || typeof metadata !== 'object') return null
  const coverage = (metadata as { coverage?: unknown }).coverage
  if (!coverage || typeof coverage !== 'object') return null
  return coverage as CoverageInfo
}

function asDisplayLimit(output: ToolOutput): number | null {
  const metadata = output.metadata
  if (!metadata || typeof metadata !== 'object') return null
  const v = (metadata as { displayLimit?: unknown }).displayLimit
  return typeof v === 'number' ? v : null
}

function asSearchMode(output: ToolOutput): string | null {
  const metadata = output.metadata
  if (!metadata || typeof metadata !== 'object') return null
  const v = (metadata as { searchMode?: unknown }).searchMode
  return typeof v === 'string' ? v : null
}

function asSearchInput(output: ToolOutput): SearchEventsInput | null {
  const metadata = output.metadata
  if (!metadata || typeof metadata !== 'object') return null
  const input = (metadata as { toolInput?: unknown }).toolInput
  return input && typeof input === 'object' ? (input as SearchEventsInput) : null
}

function asVenue(output: ToolOutput): VenueDetailsData | null {
  const venue = output.venue
  if (venue && typeof venue === 'object') return venue as VenueDetailsData
  return null
}

function asDirections(output: ToolOutput): DirectionsData | null {
  // get_directions returns a structured `directions` field carrying identity
  // (eventId / venueId) for compound relation validation.
  const d = output.directions
  if (d && typeof d === 'object' && typeof (d as { mapsUrl?: unknown }).mapsUrl === 'string') {
    return d as DirectionsData
  }
  // Fall back to the flat legacy fields for safety.
  if (
    typeof output.mapsUrl === 'string' &&
    typeof output.venueName === 'string'
  ) {
    return {
      venueName: output.venueName,
      address: asString(output.address) ?? '',
      mapsUrl: output.mapsUrl,
      eventName: asString(output.eventName) ?? undefined,
      eventId: asString(output.eventId) ?? undefined,
      venueId: asString(output.venueId) ?? undefined,
    }
  }
  return null
}

function errorCode(output: ToolOutput): string | null {
  return asString(output.error)
}

function kindFor(toolName: string): LedgerArtifactKind {
  switch (toolName) {
    case 'search_events':
      return 'search'
    case 'list_saved_events':
      return 'saved-events'
    case 'get_event_details':
      return 'event-details'
    case 'get_venue_details':
      return 'venue-details'
    case 'get_directions':
      return 'directions'
    case 'check_event_saved':
      return 'check-saved'
    case 'save_event':
    case 'unsave_event':
      return 'mutation'
    case 'retain_search_results':
      return 'retention'
    case 'reject_search_results':
      return 'rejection'
    default:
      return 'tool-error'
  }
}

/** Derive a normalized mutation outcome from a save/unsave tool output. */
export function normalizeMutationOutcome(toolName: string, output: ToolOutput): MutationOutcome {
  const code = errorCode(output)
  const success = output.success === true
  if (code === 'not_authenticated') return 'unauthenticated'
  if (code === 'event_not_found') return 'not_found'
  if (!success) {
    if (toolName === 'unsave_event' && code === 'not_saved') return 'already_applied'
    return 'failed'
  }
  if (code === 'already_saved') return 'already_applied'
  return 'applied'
}

const MUTATION_MESSAGES_EN: Record<MutationOutcome, Record<string, string>> = {
  applied: {
    save_event: 'Saved it to your list.',
    unsave_event: 'Removed it from your saved list.',
  },
  already_applied: {
    save_event: "That event is already in your saved list.",
    unsave_event: "That event wasn't in your saved list.",
  },
  denied: {
    save_event: "I couldn't save that event.",
    unsave_event: "I couldn't remove that event.",
  },
  unauthenticated: {
    save_event: 'You need to log in to save events.',
    unsave_event: 'You need to log in to manage your saved events.',
  },
  not_found: {
    save_event: "I couldn't find that event — it may have been removed.",
    unsave_event: "I couldn't find that event — it may have been removed.",
  },
  failed: {
    save_event: "Something went wrong saving the event. Please try again.",
    unsave_event: "Something went wrong removing the event. Please try again.",
  },
}

const MUTATION_MESSAGES_ES: Record<MutationOutcome, Record<string, string>> = {
  applied: {
    save_event: 'Lo guardé en tu lista.',
    unsave_event: 'Lo saqué de tus guardados.',
  },
  already_applied: {
    save_event: 'Ese evento ya está en tu lista de guardados.',
    unsave_event: 'Ese evento no estaba en tu lista.',
  },
  denied: {
    save_event: 'No pude guardar ese evento.',
    unsave_event: 'No pude quitar ese evento.',
  },
  unauthenticated: {
    save_event: 'Tenés que iniciar sesión para guardar eventos.',
    unsave_event: 'Tenés que iniciar sesión para administrar tus guardados.',
  },
  not_found: {
    save_event: 'No encontré ese evento — puede que lo hayan dado de baja.',
    unsave_event: 'No encontré ese evento — puede que lo hayan dado de baja.',
  },
  failed: {
    save_event: 'Algo salió mal al guardar. Probá de nuevo.',
    unsave_event: 'Algo salió mal al quitar. Probá de nuevo.',
  },
}

export function mutationMessage(
  toolName: 'save_event' | 'unsave_event',
  outcome: MutationOutcome,
  locale: 'en' | 'es'
): string {
  const table = locale === 'es' ? MUTATION_MESSAGES_ES : MUTATION_MESSAGES_EN
  return table[outcome][toolName]
}

/**
 * Tri-state saved contribution of a mutation outcome. Successful save/already_saved
 * → true; successful unsave/not_saved → false; failed/denied/unauthenticated/not_found
 * → null (do not overwrite prior known value).
 */
export function mutationSavedState(
  toolName: 'save_event' | 'unsave_event',
  outcome: MutationOutcome
): boolean | null {
  if (outcome === 'applied' || outcome === 'already_applied') {
    return toolName === 'save_event' ? true : false
  }
  return null
}

function asReceipt(
  toolName: string,
  input: unknown,
  output: ToolOutput,
  locale: 'en' | 'es'
): OperationReceipt | null {
  if (toolName !== 'save_event' && toolName !== 'unsave_event') return null
  const eventId = asString((input as { eventId?: unknown })?.eventId) ?? ''
  const outcome = normalizeMutationOutcome(toolName, output)
  // Structured, deterministic localized message only — never `formatted` prose.
  const message = mutationMessage(toolName as 'save_event' | 'unsave_event', outcome, locale)

  return {
    toolCallId: '',
    toolName: toolName as 'save_event' | 'unsave_event',
    eventId,
    outcome,
    message,
  }
}

/**
 * Chronological saved-state evidence. Each ledger event is timestamped
 * evidence, applied in `(stepIndex, callIndex)` order.
 */
export type SavedEvidence =
  | { kind: 'prior_authoritative_state'; saved: boolean }
  | { kind: 'saved_list_membership'; saved: true }
  | { kind: 'check_saved'; saved: boolean }
  | { kind: 'mutation'; saved: boolean }

/**
 * Tri-state saved resolution for a displayed event, as a chronological evidence
 * reducer. The latest successful evidence wins by `(stepIndex, callIndex)`:
 * `list_saved_events` membership establishes `true` at that call's position;
 * a later successful save/unsave overrides it; `already_saved` gives true and
 * `not_saved` gives false; failed/denied/unauthenticated/not-found never
 * overwrite the prior known value. Absent any evidence, the prior known value
 * (or null) stands. Search/details stay null without evidence.
 */
export function resolveSavedState(
  eventId: string,
  ledger: Ledger,
  requestId: string,
  priorSaved?: Record<string, boolean>
): SavedState {
  let result: SavedState =
    priorSaved && typeof priorSaved[eventId] === 'boolean' ? priorSaved[eventId] : null

  const entries = ledger
    .all()
    .filter((e) => e.requestId === requestId)
    .sort((a, b) => a.stepIndex - b.stepIndex || a.callIndex - b.callIndex)

  for (const e of entries) {
    if (
      e.kind === 'saved-events' &&
      e.success &&
      e.events.some((ev) => ev.id === eventId)
    ) {
      result = true
      continue
    }
    if (e.kind === 'check-saved' && e.success && e.checkSaved?.eventId === eventId) {
      result = e.checkSaved.isSaved
      continue
    }
    if (e.kind === 'mutation' && e.receipt && e.receipt.eventId === eventId) {
      const s = mutationSavedState(e.receipt.toolName, e.receipt.outcome)
      if (s !== null) result = s
    }
  }
  return result
}

function asCheckSaved(toolName: string, input: unknown, output: ToolOutput): CheckSavedState | null {
  if (toolName !== 'check_event_saved') return null
  const eventId = asString((input as { eventId?: unknown })?.eventId) ?? ''
  const metadata = output.metadata as { isSaved?: unknown } | undefined
  const isSaved = typeof metadata?.isSaved === 'boolean' ? metadata.isSaved : false
  return { eventId, isSaved }
}

function asRetained(input: unknown, output: ToolOutput): string[] {
  const retained = output.retained
  if (Array.isArray(retained)) return retained.filter((x): x is string => typeof x === 'string')
  const ids = (input as { sourceToolCallIds?: unknown })?.sourceToolCallIds
  if (Array.isArray(ids)) return ids.filter((x): x is string => typeof x === 'string')
  return []
}

function asRejected(input: unknown, output: ToolOutput): string[] {
  const rejected = output.rejected
  if (Array.isArray(rejected)) return rejected.filter((x): x is string => typeof x === 'string')
  const ids = (input as { sourceToolCallIds?: unknown })?.sourceToolCallIds
  if (Array.isArray(ids)) return ids.filter((x): x is string => typeof x === 'string')
  return []
}

/**
 * Build a ledger entry from a recorded tool execution.
 */
export function recordToolResult(
  requestId: string,
  result: RecordedToolResult,
  stepIndex: number,
  callIndex: number,
  locale: 'en' | 'es'
): LedgerEntry {
  const { toolCallId, toolName, input, output } = result
  const events = asEvents(output)
  const code = errorCode(output)
  const isAuthBlocked = code === 'not_authenticated'

  let kind = kindFor(toolName)
  if (isAuthBlocked && (toolName === 'list_saved_events' || toolName === 'check_event_saved')) {
    kind = 'auth-requirement'
  }

  const receipt = asReceipt(toolName, input, output, locale)
  if (receipt) receipt.toolCallId = toolCallId

  const metadata = output.metadata as { resultCount?: unknown } | undefined
  const count = typeof metadata?.resultCount === 'number' ? metadata.resultCount : events.length

  return {
    ...emptyEntry({
      requestId,
      stepIndex,
      callIndex,
      toolCallId,
      toolName,
      success: result.success,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      kind,
      input,
      events,
      count,
      coverage: kind === 'search' ? asCoverage(output) : null,
      searchInput: kind === 'search' ? asSearchInput(output) : null,
      displayLimit: kind === 'search' ? asDisplayLimit(output) : null,
      searchMode: kind === 'search' ? asSearchMode(output) : null,
      eventIds: events.map((e) => e.id),
      zeroResults: result.success && count === 0 && events.length === 0,
      directions: kind === 'directions' ? asDirections(output) : null,
      venue: kind === 'venue-details' ? asVenue(output) : null,
      receipt,
      checkSaved: kind === 'check-saved' ? asCheckSaved(toolName, input, output) : null,
      retainedToolCallIds: kind === 'retention' && result.success ? asRetained(input, output) : [],
      rejectedToolCallIds: kind === 'rejection' && result.success ? asRejected(input, output) : [],
      authRequired: isAuthBlocked,
      error: kind === 'tool-error' || !result.success ? code ?? 'execution_error' : null,
    }),
  }
}

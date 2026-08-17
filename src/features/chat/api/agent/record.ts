/**
 * Convert a single tool execution into a typed ledger entry.
 *
 * Joins the tool call to its result by toolCallId and normalizes each tool's
 * output into the artifact payload the validator/fallback/finalizer consume.
 * Tool output is UNTRUSTED (model-navigable) — only structured fields are
 * trusted, and the mutation receipt is re-derived deterministically here.
 */

import type {
  ChatEventPayload,
  DirectionsData,
  MutationOutcome,
  OperationReceipt,
  VenueDetailsData,
} from '#shared/lib/types.ts'
import type { CoverageInfo } from '../tools/coverage-guard.ts'
import type { SearchEventsInput } from '../tools/search-events.ts'
import { emptyEntry, type LedgerArtifactKind, type LedgerEntry } from './ledger.ts'

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
  // get_directions now returns a structured `directions` field.
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

function asReceipt(
  toolName: string,
  input: unknown,
  output: ToolOutput,
  locale: 'en' | 'es'
): OperationReceipt | null {
  if (toolName !== 'save_event' && toolName !== 'unsave_event') return null
  const eventId = asString((input as { eventId?: unknown })?.eventId) ?? ''
  const outcome = normalizeMutationOutcome(toolName, output)
  // Prefer the server's own message when available (it carries the event name),
  // else fall back to the deterministic normalized message.
  let message = ''
  if (typeof output.formatted === 'string') {
    try {
      const parsed = JSON.parse(output.formatted) as { message?: unknown }
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        message = parsed.message
      }
    } catch {
      /* formatted is not JSON — use deterministic message */
    }
  }
  if (!message.trim()) message = mutationMessage(toolName as 'save_event' | 'unsave_event', outcome, locale)

  return {
    toolCallId: '',
    toolName: toolName as 'save_event' | 'unsave_event',
    eventId,
    outcome,
    message,
  }
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
      authRequired: isAuthBlocked,
      error: kind === 'tool-error' || !result.success ? code ?? 'execution_error' : null,
    }),
  }
}

/**
 * Typed artifact ledger for the v3 agent turn.
 *
 * Replaces the legacy global `allEvents` Map and generic `events` sniffing.
 * Every tool execution produces exactly one ledger entry, joined to its tool
 * call by `toolCallId`, preserving model call order even when parallel tool
 * executions complete in reverse order.
 */

import type {
  ChatEventPayload,
  DirectionsData,
  OperationReceipt,
  VenueDetailsData,
} from '#shared/lib/types.ts'
import type { CoverageInfo } from '../tools/coverage-guard.ts'
import type { SearchEventsInput } from '../tools/search-events.ts'

export type LedgerArtifactKind =
  | 'search'
  | 'saved-events'
  | 'event-details'
  | 'venue-details'
  | 'directions'
  | 'mutation'
  | 'check-saved'
  | 'auth-requirement'
  | 'tool-error'

export interface LedgerEntry {
  requestId: string
  /** Zero-based index of the work generation (step) that produced this call. */
  stepIndex: number
  /** Zero-based index of this call within its step, in model call order. */
  callIndex: number
  toolCallId: string
  toolName: string
  success: boolean
  startedAt: string
  completedAt: string
  kind: LedgerArtifactKind
  input: unknown
  /** Events returned by search / saved-events / event-details artifacts. */
  events: ChatEventPayload[]
  /** Result count reported by the tool (search / saved-events). */
  count: number
  coverage: CoverageInfo | null
  searchInput: SearchEventsInput | null
  /** Actual display limit the search applied (canonical intent displayLimit). */
  displayLimit: number | null
  /** Retrieval mode reported by search_events (semantic/filter_only/now/surprise). */
  searchMode: string | null
  /** Explicit ordered event ids (mirror of `events` order) for search/saved/details. */
  eventIds: string[]
  /** True when the artifact succeeded but returned zero events. */
  zeroResults: boolean
  directions: DirectionsData | null
  venue: VenueDetailsData | null
  receipt: OperationReceipt | null
  /** True when the call failed only because the user was not authenticated. */
  authRequired: boolean
  error: string | null
}

export class Ledger {
  private entries: LedgerEntry[] = []

  push(entry: LedgerEntry): void {
    this.entries.push(entry)
  }

  all(): LedgerEntry[] {
    return this.entries
  }

  /** Successful search calls, in ledger (model call) order. */
  successfulSearches(): LedgerEntry[] {
    return this.entries.filter((e) => e.kind === 'search' && e.success)
  }

  /**
   * Highest step index that contains at least one successful search call.
   * Discovery fallback only ever reads from this step (never earlier ones).
   */
  highestSearchStep(): number {
    let highest = -1
    for (const e of this.entries) {
      if (e.kind === 'search' && e.success && e.stepIndex > highest) highest = e.stepIndex
    }
    return highest
  }

  /** Successful search calls in the given step, in call order. */
  searchesInStep(stepIndex: number, requestId?: string): LedgerEntry[] {
    return this.entries.filter(
      (e) =>
        e.kind === 'search' &&
        e.success &&
        e.stepIndex === stepIndex &&
        (!requestId || e.requestId === requestId)
    )
  }

  /** Successful event-details artifact for a specific event id (most recent first). */
  eventDetailsFor(eventId: string, requestId?: string): LedgerEntry | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]
      if (
        e.kind === 'event-details' &&
        e.success &&
        (!requestId || e.requestId === requestId) &&
        e.events.some((ev) => ev.id === eventId)
      ) {
        return e
      }
    }
    return null
  }

  /** Successful saved-events artifact (most recent). */
  savedEventsArtifact(): LedgerEntry | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]
      if (e.kind === 'saved-events' && e.success) return e
    }
    return null
  }

  /** Successful directions artifact (most recent). */
  directionsArtifact(): LedgerEntry | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]
      if (e.kind === 'directions' && e.success && e.directions) return e
    }
    return null
  }

  /** Successful venue-details artifact (most recent). */
  venueDetailsArtifact(): LedgerEntry | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]
      if (e.kind === 'venue-details' && e.success && e.venue) return e
    }
    return null
  }

  /**
   * Mutation receipts, deduped by `toolName:eventId` in first-appearance order.
   * Identical save/unsave(eventId) calls collapse to ONE operation.
   */
  mutationReceipts(requestId?: string): OperationReceipt[] {
    const seen = new Set<string>()
    const out: OperationReceipt[] = []
    for (const e of this.entries) {
      if (e.kind !== 'mutation' || !e.receipt) continue
      if (requestId && e.requestId !== requestId) continue
      const key = `${e.receipt.toolName}:${e.receipt.eventId}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(e.receipt)
    }
    return out
  }

  /** Tool call ids behind the deduped mutation receipts (for provenance). */
  mutationToolCallIds(requestId?: string): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const e of this.entries) {
      if (e.kind !== 'mutation' || !e.receipt) continue
      if (requestId && e.requestId !== requestId) continue
      const key = `${e.receipt.toolName}:${e.receipt.eventId}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(e.toolCallId)
    }
    return out
  }

  /** Successful read artifacts (search/saved/details/directions/venue) in ledger order. */
  successfulReads(requestId?: string): LedgerEntry[] {
    const kinds: LedgerArtifactKind[] = [
      'search',
      'saved-events',
      'event-details',
      'venue-details',
      'directions',
    ]
    return this.entries.filter(
      (e) => e.success && kinds.includes(e.kind) && (!requestId || e.requestId === requestId)
    )
  }

  /**
   * The final relevant successful read, ordered by (stepIndex, callIndex).
   * This is the single read artifact the fallback keys its content off of,
   * so a later saved/details/directions/venue read wins over earlier search.
   */
  finalRelevantRead(requestId?: string): LedgerEntry | null {
    const reads = this.successfulReads(requestId)
    if (reads.length === 0) return null
    return reads.reduce((best, e) =>
      e.stepIndex > best.stepIndex ||
      (e.stepIndex === best.stepIndex && e.callIndex > best.callIndex)
        ? e
        : best
    )
  }

  /** Find a tool call by id (for provenance validation). */
  find(toolCallId: string): LedgerEntry | null {
    return this.entries.find((e) => e.toolCallId === toolCallId) ?? null
  }

  /** Map event id -> the successful ledger entries that produced it. */
  eventSources(): Map<string, LedgerEntry[]> {
    const map = new Map<string, LedgerEntry[]>()
    for (const e of this.entries) {
      if (!e.success) continue
      for (const ev of e.events) {
        const list = map.get(ev.id) ?? []
        list.push(e)
        map.set(ev.id, list)
      }
    }
    return map
  }
}

export function emptyEntry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    requestId: '',
    stepIndex: 0,
    callIndex: 0,
    toolCallId: '',
    toolName: 'unknown',
    success: false,
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(0).toISOString(),
    kind: 'tool-error',
    input: undefined,
    events: [],
    count: 0,
    coverage: null,
    searchInput: null,
    displayLimit: null,
    searchMode: null,
    eventIds: [],
    zeroResults: false,
    directions: null,
    venue: null,
    receipt: null,
    authRequired: false,
    error: null,
    ...overrides,
  }
}

/**
 * Typed artifact ledger for the v4 agent turn.
 *
 * Replaces the legacy global `allEvents` Map and generic `events` sniffing.
 * Every tool execution produces exactly one ledger entry, joined to its tool
 * call by `toolCallId`, preserving model call order even when parallel tool
 * executions complete in reverse order.
 *
 * Search discovery is modelled as ordered SearchStages: every work generation
 * that calls `search_events` creates ONE stage (successful, empty, OR failed).
 * A new stage supersedes earlier stages the moment it is created — before its
 * results are known. A stage can additionally be REJECTED (distinct from being
 * merely superseded) via an explicit `reject_search_results` control call, or
 * earlier sources can be RETAINED (stage-scoped) via `retain_search_results`.
 * All eligibility is typed and structural — never parsed from prose.
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
  | 'retention'
  | 'rejection'
  | 'auth-requirement'
  | 'tool-error'

/** The `check_event_saved` artifact payload: {eventId, isSaved}. */
export interface CheckSavedState {
  eventId: string
  isSaved: boolean
}

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
  /** check_event_saved payload (tri-state saved evidence), when kind === 'check-saved'. */
  checkSaved: CheckSavedState | null
  /** Earlier search sources reactivated by a `retain_search_results` call. */
  retainedToolCallIds: string[]
  /** Search sources rejected by a `reject_search_results` call. */
  rejectedToolCallIds: string[]
  /** True when the call failed only because the user was not authenticated. */
  authRequired: boolean
  error: string | null
}

// =============================================================================
// SEARCH STAGE MODEL
// =============================================================================

export type SearchStageEligibility = 'active' | 'superseded' | 'rejected'
export type SearchStageOutcome =
  | 'success'
  | 'empty'
  | 'partial_success'
  | 'partial_failure'
  | 'failed'

export interface SearchStage {
  requestId: string
  stageId: string
  stepIndex: number
  /** Search tool call ids in model call order within this step. */
  toolCallIds: string[]
  eligibility: SearchStageEligibility
  outcome: SearchStageOutcome
  /** stageId of the next later stage that superseded this one (null for active). */
  supersededByStageId: string | null
  /** Earlier sources explicitly retained by THIS stage's generation (active only). */
  retainedSourceToolCallIds: string[]
}

/** Validation state of a single search source tool call. */
export type SearchSourceStatus = 'active' | 'retained' | 'rejected' | 'superseded' | 'unknown'

function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false
  return true
}

/** Synthetic step index for post-plan mutation receipts (sorts after all work). */
export const MUTATION_STEP_INDEX = Number.MAX_SAFE_INTEGER

export class Ledger {
  private entries: LedgerEntry[] = []

  push(entry: LedgerEntry): void {
    this.entries.push(entry)
  }

  /**
   * Record a post-plan mutation receipt produced by the deterministic executor
   * (never the work loop). Uses a synthetic high step index so it sorts after
   * all work-loop evidence in the chronological saved-state reducer.
   */
  recordMutationReceipt(receipt: OperationReceipt, requestId: string): void {
    const applied = receipt.outcome === 'applied' || receipt.outcome === 'already_applied'
    this.entries.push(
      emptyEntry({
        requestId,
        stepIndex: MUTATION_STEP_INDEX,
        callIndex: 0,
        toolCallId: receipt.toolCallId,
        toolName: receipt.toolName,
        success: applied,
        kind: 'mutation',
        receipt,
        authRequired: receipt.outcome === 'unauthenticated',
        error: applied ? null : receipt.outcome,
      })
    )
  }

  all(): LedgerEntry[] {
    return this.entries
  }

  /** Successful search calls, in ledger (model call) order. */
  successfulSearches(): LedgerEntry[] {
    return this.entries.filter((e) => e.kind === 'search' && e.success)
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

  /** Successful retention records (kind === 'retention'), in ledger order. */
  retentionRecords(requestId?: string): LedgerEntry[] {
    return this.entries.filter(
      (e) => e.kind === 'retention' && e.success && (!requestId || e.requestId === requestId)
    )
  }

  /** Successful rejection records (kind === 'rejection'), in ledger order. */
  rejectionRecords(requestId?: string): LedgerEntry[] {
    return this.entries.filter(
      (e) => e.kind === 'rejection' && e.success && (!requestId || e.requestId === requestId)
    )
  }

  /** Union of search sources explicitly rejected this turn. */
  rejectedSourceToolCallIds(requestId?: string): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const e of this.rejectionRecords(requestId)) {
      for (const id of e.rejectedToolCallIds) {
        if (seen.has(id)) continue
        seen.add(id)
        out.push(id)
      }
    }
    return out
  }

  /**
   * Stage-scoped retention. Retention is only in force for the ACTIVE stage:
   * a newer search stage invalidates earlier retention unless the newer stage
   * explicitly retained the source again. Rejected sources are never retained.
   */
  retainedSearchToolCallIds(requestId?: string): string[] {
    let activeStep = -1
    for (const e of this.entries) {
      if (e.kind === 'search' && (!requestId || e.requestId === requestId)) {
        if (e.stepIndex > activeStep) activeStep = e.stepIndex
      }
    }
    if (activeStep < 0) return []

    const rejected = new Set(this.rejectedSourceToolCallIds(requestId))
    const activeIds = new Set(
      this.entries
        .filter((e) => e.kind === 'search' && e.stepIndex === activeStep && (!requestId || e.requestId === requestId))
        .map((e) => e.toolCallId)
    )
    // A rejected latest stage has no retention power and no eligibility.
    if (activeIds.size > 0 && [...activeIds].every((id) => rejected.has(id))) return []

    const out: string[] = []
    const seen = new Set<string>()
    for (const e of this.retentionRecords(requestId)) {
      if (e.stepIndex < activeStep) continue // invalidated by a newer stage
      for (const id of e.retainedToolCallIds) {
        if (seen.has(id) || rejected.has(id) || activeIds.has(id)) continue
        seen.add(id)
        out.push(id)
      }
    }
    return out
  }

  /**
   * Ordered search stages. A stage is one work generation that contained at
   * least one `search_events` call (successful, empty, OR failed). The last
   * stage is `active`; an explicitly rejected earlier stage is `rejected`;
   * every other earlier stage is `superseded`. Call order within a stage is
   * model call order (callIndex), never result-completion order.
   */
  searchStages(requestId?: string): SearchStage[] {
    const byStep = new Map<number, LedgerEntry[]>()
    for (const e of this.entries) {
      if (e.kind !== 'search') continue
      if (requestId && e.requestId !== requestId) continue
      const list = byStep.get(e.stepIndex) ?? []
      list.push(e)
      byStep.set(e.stepIndex, list)
    }
    const steps = [...byStep.keys()].sort((a, b) => a - b)
    if (steps.length === 0) return []

    // Whole-stage rejection records map to a step index by exact toolCallIds set.
    const rejections = this.rejectionRecords(requestId)
    const rejectedSteps = new Set<number>()
    for (const rec of rejections) {
      for (const step of steps) {
        const ids = byStep.get(step)!.map((e) => e.toolCallId)
        if (setsEqual(ids, rec.rejectedToolCallIds)) rejectedSteps.add(step)
      }
    }

    const retained = this.retainedSearchToolCallIds(requestId)
    const lastStep = steps[steps.length - 1]

    return steps.map((stepIndex, idx) => {
      const entries = byStep.get(stepIndex)!.sort((a, b) => a.callIndex - b.callIndex)
      const toolCallIds = entries.map((e) => e.toolCallId)
      const succeeded = entries.filter((e) => e.success)
      const failed = entries.filter((e) => !e.success)
      const totalEvents = succeeded.reduce((s, e) => s + e.events.length, 0)
      // Aggregate 5-state outcome:
      //   success          = all calls succeeded, at least one event.
      //   empty            = all calls succeeded, zero events.
      //   partial_success  = some events returned, at least one call failed.
      //   partial_failure  = no events, at least one empty success, at least one failed.
      //   failed           = all calls failed.
      let outcome: SearchStageOutcome
      if (failed.length === 0) {
        outcome = totalEvents > 0 ? 'success' : 'empty'
      } else if (succeeded.length === 0) {
        outcome = 'failed'
      } else if (totalEvents > 0) {
        outcome = 'partial_success'
      } else {
        outcome = 'partial_failure'
      }
      const isActive = stepIndex === lastStep
      const eligibility: SearchStageEligibility = rejectedSteps.has(stepIndex)
        ? 'rejected'
        : isActive
          ? 'active'
          : 'superseded'
      return {
        requestId: entries[0].requestId,
        stageId: `stage-${stepIndex}`,
        stepIndex,
        toolCallIds,
        eligibility,
        outcome,
        supersededByStageId: idx === steps.length - 1 ? null : `stage-${steps[idx + 1]}`,
        retainedSourceToolCallIds: isActive ? retained : [],
      }
    })
  }

  /** The active (latest) search stage, or null when no search ran. */
  activeStage(requestId?: string): SearchStage | null {
    return this.searchStages(requestId).at(-1) ?? null
  }

  /**
   * Validation state of a search source. Only `active` and `retained` sources
   * are selectable; `rejected` and `superseded` are rejected (with distinct
   * fallback reasons) and `unknown` is not a search source.
   */
  searchSourceStatus(toolCallId: string, requestId?: string): SearchSourceStatus {
    const entry = this.entries.find((e) => e.toolCallId === toolCallId)
    if (!entry || entry.kind !== 'search' || (requestId && entry.requestId !== requestId)) {
      return 'unknown'
    }
    // Rejected wins over active: an explicitly rejected latest stage is not
    // selectable even though it is the last search stage.
    if (this.rejectedSourceToolCallIds(requestId).includes(toolCallId)) return 'rejected'
    const active = this.activeStage(requestId)
    if (active && active.toolCallIds.includes(toolCallId)) return 'active'
    if (this.retainedSearchToolCallIds(requestId).includes(toolCallId)) return 'retained'
    return 'superseded'
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

  /** Latest successful event-details artifact (any event). */
  latestEventDetails(requestId?: string): LedgerEntry | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]
      if (e.kind === 'event-details' && e.success && e.events.length > 0 && (!requestId || e.requestId === requestId)) {
        return e
      }
    }
    return null
  }

  /** Successful saved-events artifact (most recent). */
  savedEventsArtifact(requestId?: string): LedgerEntry | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]
      if (e.kind === 'saved-events' && e.success && (!requestId || e.requestId === requestId)) return e
    }
    return null
  }

  /** Successful check-saved artifact for an event id (most recent). */
  checkSavedFor(eventId: string, requestId?: string): LedgerEntry | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]
      if (
        e.kind === 'check-saved' &&
        e.success &&
        e.checkSaved?.eventId === eventId &&
        (!requestId || e.requestId === requestId)
      ) {
        return e
      }
    }
    return null
  }

  /** Successful directions artifact (most recent). */
  directionsArtifact(requestId?: string): LedgerEntry | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]
      if (e.kind === 'directions' && e.success && e.directions && (!requestId || e.requestId === requestId)) return e
    }
    return null
  }

  /** Successful venue-details artifact (most recent). */
  venueDetailsArtifact(requestId?: string): LedgerEntry | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]
      if (e.kind === 'venue-details' && e.success && e.venue && (!requestId || e.requestId === requestId)) return e
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

  /**
   * Successful events-bearing reads (search/saved/details) in ledger order.
   * Directions and venue are compound siblings, never primary read candidates.
   */
  successfulEventReads(requestId?: string): LedgerEntry[] {
    const kinds: LedgerArtifactKind[] = ['search', 'saved-events', 'event-details']
    return this.entries.filter(
      (e) => e.success && kinds.includes(e.kind) && (!requestId || e.requestId === requestId)
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
    checkSaved: null,
    retainedToolCallIds: [],
    rejectedToolCallIds: [],
    authRequired: false,
    error: null,
    ...overrides,
  }
}

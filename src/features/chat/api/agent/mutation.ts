/**
 * Deterministic post-plan mutation planner + executor (v5).
 *
 * The work loop never executes save/unsave. After the finalizer plan is
 * validated, this module (1) derives the single authorized mutation target from
 * the typed intent + deterministic reference resolution + the validated
 * selection, and (2) executes it exactly once, producing a normalized receipt.
 *
 * Target authorization (before any side effect):
 *   - a prior-target mutation must equal the server-resolved event id;
 *   - a pinned mutation must equal the pinned event id;
 *   - a current-search mutation must equal the lead selected event, bound to
 *     its exact source artifact;
 *   - named-venue references, ambiguous references, and unresolved targets
 *     never authorize a mutation.
 *
 * Save and unsave are distinguished by the typed intent action. Execution is
 * idempotent (a single planned mutation per turn, deduped by action:eventId).
 */

import type {
  MutationIntent,
  MutationMessageKey,
  OperationReceipt,
  PlannedMutation,
} from '#shared/lib/types.ts'
import type { UserToolContext } from '../user-tools.server.ts'
import { saveEventForUser, unsaveEventForUser } from '../user-tools.server.ts'
import { normalizeMutationOutcome, mutationMessage } from './record.ts'

export type MutationPlanResult =
  | { status: 'none' }
  | { status: 'ambiguous' }
  | { status: 'resolved'; planned: PlannedMutation }

export interface PlanMutationInput {
  intent: MutationIntent
  /** Prior event id resolved deterministically from the typed reference. */
  resolvedEventId?: string
  /** Resolved pinned event id (only when pin mode resolved successfully). */
  pinnedEventId?: string
  /** Lead selected event id from the validated plan (current-search target). */
  selectedEventId?: string
  /** Exact source artifact of the lead selected event. */
  selectedSourceToolCallId?: string
}

/**
 * Derive the single authorized mutation from typed intent + deterministic
 * resolution. Returns `none` (no intent), `ambiguous` (clarify, zero side
 * effects), or `resolved` with the validated plan.
 */
export function planMutation(input: PlanMutationInput): MutationPlanResult {
  if (input.intent.kind === 'none') return { status: 'none' }
  const action = input.intent.kind

  // Pinned mode: the mutation may target only the pinned event.
  if (input.pinnedEventId) {
    return {
      status: 'resolved',
      planned: {
        action,
        eventId: input.pinnedEventId,
        source: { kind: 'pinned_event' },
      },
    }
  }

  switch (input.intent.targetReference.kind) {
    case 'named_venue':
      // A venue reference is not an event — it can never authorize a mutation.
      return { status: 'ambiguous' }
    case 'ordinal':
    case 'lead':
    case 'other':
    case 'named_event': {
      if (input.resolvedEventId) {
        return {
          status: 'resolved',
          planned: {
            action,
            eventId: input.resolvedEventId,
            source: { kind: 'resolved_prior_target' },
          },
        }
      }
      return { status: 'ambiguous' }
    }
    case 'none': {
      // No prior reference: the target is the current search's lead selection.
      if (input.selectedEventId && input.selectedSourceToolCallId) {
        return {
          status: 'resolved',
          planned: {
            action,
            eventId: input.selectedEventId,
            source: {
              kind: 'selected_current_event',
              sourceToolCallId: input.selectedSourceToolCallId,
            },
          },
        }
      }
      return { status: 'ambiguous' }
    }
    case 'ambiguous':
      return { status: 'ambiguous' }
  }
}

/** Execute one authorized mutation exactly once, returning a normalized receipt. */
export async function executeMutation(
  planned: PlannedMutation,
  userContext: UserToolContext,
  locale: 'en' | 'es'
): Promise<OperationReceipt> {
  const toolName = planned.action === 'save' ? 'save_event' : 'unsave_event'
  const raw =
    planned.action === 'save'
      ? await saveEventForUser(planned.eventId, userContext)
      : await unsaveEventForUser(planned.eventId, userContext)
  const outcome = normalizeMutationOutcome(
    toolName,
    raw as unknown as Record<string, unknown>
  )
  return {
    toolCallId: `mutation:${toolName}:${planned.eventId}`,
    toolName,
    eventId: planned.eventId,
    outcome,
    message: mutationMessage(toolName, outcome, locale),
  }
}

/**
 * Execute a bounded set of planned mutations exactly once each (deduped by
 * `action:eventId`). Never throws: a thrown execution becomes a truthful
 * `failed` receipt.
 */
export async function executeMutations(
  planned: PlannedMutation[],
  userContext: UserToolContext,
  locale: 'en' | 'es'
): Promise<OperationReceipt[]> {
  const seen = new Set<string>()
  const unique: PlannedMutation[] = []
  for (const p of planned) {
    const key = `${p.action}:${p.eventId}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(p)
  }

  const receipts: OperationReceipt[] = []
  for (const p of unique) {
    try {
      receipts.push(await executeMutation(p, userContext, locale))
    } catch (error) {
      console.error('[mutation] execution failed:', error)
      receipts.push({
        toolCallId: `mutation:${p.action === 'save' ? 'save_event' : 'unsave_event'}:${p.eventId}`,
        toolName: p.action === 'save' ? 'save_event' : 'unsave_event',
        eventId: p.eventId,
        outcome: 'failed',
        message:
          p.action === 'save'
            ? mutationMessage('save_event', 'failed', locale)
            : mutationMessage('unsave_event', 'failed', locale),
      })
    }
  }
  return receipts
}

/**
 * Derive the truthful mutation lead key from normalized receipts. Only an
 * `applied` outcome claims an update; every other outcome is neutral or
 * already-up-to-date and never claims a change that did not happen.
 */
export function deriveMutationMessageKey(receipts: OperationReceipt[]): MutationMessageKey {
  if (receipts.length === 0) return 'mutation_failed'
  const outcomes = receipts.map((r) => r.outcome)
  if (outcomes.length === 1) {
    switch (outcomes[0]) {
      case 'applied':
        return 'mutation_applied'
      case 'already_applied':
        return 'mutation_already_applied'
      case 'unauthenticated':
        return 'mutation_unauthenticated'
      case 'not_found':
        return 'mutation_not_found'
      case 'failed':
      case 'denied':
        return 'mutation_failed'
    }
  }
  if (outcomes.every((o) => o === 'applied')) return 'mutation_applied'
  if (outcomes.every((o) => o === 'already_applied')) return 'mutation_already_applied'
  return 'mutation_mixed'
}

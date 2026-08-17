/**
 * Follow-up context for the v3 agent turn.
 *
 * Builds compact trusted context of previously displayed events (ids, names,
 * order, saved-state) from persisted canonical responses. The model can then
 * resolve "save the second one", "tell me more", "directions", "other one",
 * "closest" without raw hidden client context. Guest ids remain UNTRUSTED —
 * tools and the validator re-check every read/mutation against the database.
 *
 * Display order is most-recent-first-adjacent: re-displayed events move to
 * their latest position, and operation state from later mutation-only
 * canonical responses is applied back onto earlier displayed events.
 */

import type { UIMessage } from 'ai'
import type {
  CanonicalChatResponse,
  OperationReceipt,
} from '#shared/lib/types.ts'

export interface PriorEventContext {
  eventId: string
  name: string
  /** True if the most recent operation on this event saved it. */
  saved: boolean
}

const MAX_PRIOR_EVENTS = 20

function normalizePart(
  part: { type?: string; data?: unknown }
): CanonicalChatResponse | null {
  if (part.type !== 'data-response') return null
  const data = part.data
  if (!data || typeof data !== 'object') return null
  return data as CanonicalChatResponse
}

function operationSaved(op: OperationReceipt): boolean {
  return (
    op.toolName === 'save_event' &&
    (op.outcome === 'applied' || op.outcome === 'already_applied')
  )
}

/** Saved state from the most recent operation on an event within one canonical. */
function savedFromOps(ops: OperationReceipt[], eventId: string): boolean | null {
  let saved: boolean | null = null
  for (const op of ops) {
    if (op.eventId === eventId) saved = operationSaved(op)
  }
  return saved
}

export function priorEventsFromCanonical(
  canonicals: Array<CanonicalChatResponse | null | undefined>
): PriorEventContext[] {
  const order: string[] = []
  const byId = new Map<string, PriorEventContext>()

  for (const canonical of canonicals) {
    if (!canonical) continue
    const ops = canonical.operations ?? []

    // Operation state applies to ANY known event — later mutation-only
    // responses update earlier displayed events.
    for (const op of ops) {
      const known = byId.get(op.eventId)
      if (known) known.saved = operationSaved(op)
    }

    // Displayed events: add-or-move to the latest position.
    for (const ev of canonical.events ?? []) {
      const opSaved = savedFromOps(ops, ev.id)
      const existing = byId.get(ev.id)
      if (existing) {
        const idx = order.indexOf(ev.id)
        if (idx !== -1) order.splice(idx, 1)
        order.push(ev.id)
        existing.name = ev.name
        if (opSaved !== null) existing.saved = opSaved
      } else {
        order.push(ev.id)
        byId.set(ev.id, { eventId: ev.id, name: ev.name, saved: opSaved ?? false })
      }
    }
  }

  return order.slice(-MAX_PRIOR_EVENTS).map((id) => byId.get(id)!)
}

export function priorEventsFromUIMessages(messages: UIMessage[]): PriorEventContext[] {
  const canonicals: CanonicalChatResponse[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of (message.parts ?? []) as Array<{ type?: string; data?: unknown }>) {
      const canonical = normalizePart(part)
      if (canonical) canonicals.push(canonical)
    }
  }
  return priorEventsFromCanonical(canonicals)
}

/** Numbered compact lines for the finalizer/system prompt ("save the second one"). */
export function formatPriorEvents(prior: PriorEventContext[]): string {
  if (prior.length === 0) return '(none)'
  return prior
    .map((e, i) => `${i + 1}. ${e.eventId}: ${e.name}${e.saved ? ' (saved)' : ''}`)
    .join('\n')
}

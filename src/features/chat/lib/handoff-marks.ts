/**
 * Scoped performance marks for the first-message handoff.
 *
 * Every handoff gets a unique id (carried in PendingFirstMessage across the
 * /chat/:id remount) and every mark name embeds it:
 * `chat:handoff:<handoffId>:<phase>`. Reading a phase for a handoff that
 * never marked it returns undefined — it can never borrow an earlier
 * handoff's mark, because the names are disjoint per id.
 */

export type HandoffPhase =
  | 'submit'
  | 'navigate'
  | 'mount'
  | 'consume'
  | 'request_start'
  | 'first_response'
  | 'complete'
  | 'guest_conversation_written'
  | 'user_persisted'

export function handoffMarkName(handoffId: string, phase: HandoffPhase): string {
  return `chat:handoff:${handoffId}:${phase}`
}

/**
 * Record a phase timestamp: writes the scoped performance.mark AND returns
 * the wall-clock `performance.now()` value for ref-based in-instance use.
 * Returns null when `performance` is unavailable (SSR/test without it).
 */
export function markHandoffPhaseTime(
  handoffId: string,
  phase: HandoffPhase
): number | null {
  const time = performance.now()
  try {
    performance.mark(handoffMarkName(handoffId, phase))
  } catch {
    // performance.mark unavailable (SSR/test) — the returned timestamp is
    // still authoritative for same-instance measurements.
  }
  return time
}

/**
 * Read a handoff phase timestamp from the performance timeline. Returns
 * undefined when the phase was never marked for THIS handoff id — missing
 * and late phases stay missing, they never fall back to another handoff's
 * entries (names are id-scoped).
 */
export function readHandoffMarkTime(
  handoffId: string,
  phase: HandoffPhase
): number | undefined {
  try {
    const entry = performance.getEntriesByName(handoffMarkName(handoffId, phase)).pop()
    return entry ? entry.startTime : undefined
  } catch {
    return undefined
  }
}

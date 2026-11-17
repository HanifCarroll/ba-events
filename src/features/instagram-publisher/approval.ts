/** The approval state machine: what a tick does with a previewed draft, given Hanif's reactions and the clock. */
import type { SkipReason } from './copy.ts'
import type { RunWindow } from './formats.ts'

/** Ticks run every 10 minutes and Slack's reactions carry no time, so a ✅ first seen within one tick of the cutoff counts. */
export const TICK_GRACE_MS = 10 * 60_000

export interface Reactions { approved: boolean; rejected: boolean }

export type Decision = { action: 'wait' } | { action: 'publish' } | { action: 'skip'; reason: SkipReason }

/**
 * `approvedSeenAt` is when a tick first saw Hanif's ✅ (the caller records it). ❌ wins over ✅ and over auto mode.
 * A ✅ given before the slot waits for the slot; a later ✅ publishes at once until the cutoff. Nothing starts
 * publishing at or after the deadline (Hoy 19:00, carousels the cutoff).
 */
export function decide(window: RunWindow, reactions: Reactions, approvedSeenAt: Date | null, auto: boolean, now: Date): Decision {
  if (reactions.rejected) return { action: 'skip', reason: { kind: 'rejected' } }
  if (now < window.publishAt) return { action: 'wait' }
  const approvedInTime = reactions.approved && approvedSeenAt !== null && approvedSeenAt.getTime() < window.cutoff.getTime() + TICK_GRACE_MS
  if (now < window.deadline && (approvedInTime || auto)) return { action: 'publish' }
  if (approvedInTime || auto) return { action: 'skip', reason: { kind: 'late', by: window.deadline } }
  if (now >= window.cutoff) return { action: 'skip', reason: { kind: 'no-approval', by: window.cutoff } }
  return { action: 'wait' }
}

/** Thrown before an Instagram write that is no longer allowed. `unapproved` waits for the ✅ to return; the others end the draft. */
export class PublishStop extends Error {
  constructor(readonly kind: 'rejected' | 'unapproved' | 'deadline', message: string) { super(message) }
}

/** The check before every new Instagram write: the deadline, then Hanif's current reactions. */
export function checkWrite(window: RunWindow, reactions: Reactions, auto: boolean, now: Date) {
  if (now >= window.deadline) throw new PublishStop('deadline', 'The publishing deadline has passed')
  if (reactions.rejected) throw new PublishStop('rejected', 'Hanif reacted ❌')
  if (!auto && !reactions.approved) throw new PublishStop('unapproved', "Hanif's ✅ is no longer on the preview")
}

/** Slack reaction names: ✅ is `white_check_mark`, ❌ is `x`. Only Hanif's reactions count. */
export const HANIF = 'U0CEZASPGG2'

export function readReactions(reactions: Array<{ name: string; users?: string[] }> | undefined): Reactions {
  const by = (name: string) => (reactions ?? []).some(reaction => reaction.name === name && (reaction.users ?? []).includes(HANIF))
  return { approved: by('white_check_mark'), rejected: by('x') }
}

import { describe, expect, it } from 'vitest'
import {
  handoffMarkName,
  markHandoffPhaseTime,
  readHandoffMarkTime,
} from './handoff-marks.ts'

describe('handoff performance marks', () => {
  it('names are scoped by the handoff id', () => {
    expect(handoffMarkName('h-1', 'submit')).toBe('chat:handoff:h-1:submit')
    expect(handoffMarkName('h-2', 'submit')).toBe('chat:handoff:h-2:submit')
    expect(handoffMarkName('h-1', 'submit')).not.toBe(handoffMarkName('h-1', 'complete'))
  })

  it('a phase never marked for a handoff stays missing, even after an earlier handoff marked it', () => {
    // Handoff A marks every phase it reaches — including the phases handoff B
    // will skip (B's guest IndexedDB write fails, so no
    // guest_conversation_written; B's submit is never minted because the
    // branch is unreachable, etc.).
    markHandoffPhaseTime('handoff-a', 'submit')
    markHandoffPhaseTime('handoff-a', 'guest_conversation_written')
    markHandoffPhaseTime('handoff-a', 'complete')

    // Handoff B only marks a subset of phases.
    markHandoffPhaseTime('handoff-b', 'mount')
    markHandoffPhaseTime('handoff-b', 'complete')

    // B's missing phases must read undefined — the timeline lookup is
    // id-scoped, so A's entries are unreachable.
    expect(readHandoffMarkTime('handoff-b', 'submit')).toBeUndefined()
    expect(readHandoffMarkTime('handoff-b', 'guest_conversation_written')).toBeUndefined()
    expect(readHandoffMarkTime('handoff-b', 'consume')).toBeUndefined()
    expect(readHandoffMarkTime('handoff-b', 'first_response')).toBeUndefined()

    // B's own phases still read back.
    expect(readHandoffMarkTime('handoff-b', 'mount')).toBeTypeOf('number')
    expect(readHandoffMarkTime('handoff-b', 'complete')).toBeTypeOf('number')

    // A's phases remain readable under A's id.
    expect(readHandoffMarkTime('handoff-a', 'guest_conversation_written')).toBeTypeOf('number')
  })

  it('reads the latest mark for a repeated phase', () => {
    markHandoffPhaseTime('handoff-c', 'first_response')
    const before = readHandoffMarkTime('handoff-c', 'first_response')!
    const after = markHandoffPhaseTime('handoff-c', 'first_response')!
    // The timeline entry is stamped microseconds after the returned
    // performance.now(); the contract is ordering, not bit equality.
    expect(after).toBeGreaterThanOrEqual(before)
    expect(readHandoffMarkTime('handoff-c', 'first_response')!).toBeGreaterThanOrEqual(after)
  })
})

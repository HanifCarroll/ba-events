import { describe, expect, it } from 'vitest'
import { HANIF, decide, readReactions } from './approval.ts'
import { baInstant } from './format.ts'
import { runWindow } from './formats.ts'

const none = { approved: false, rejected: false }
const yes = { approved: true, rejected: false }
const no = { approved: false, rejected: true }

describe('Hoy (no grace after 17:00 besides one tick)', () => {
  const hoy = runWindow('hoy', '2026-11-18')
  const at = (h: number, m = 0) => baInstant('2026-11-18', h, m)

  it('waits for the slot, then publishes an approved draft', () => {
    expect(decide(hoy, yes, at(12), false, at(12))).toEqual({ action: 'wait' })
    expect(decide(hoy, yes, at(12), false, at(17))).toEqual({ action: 'publish' })
  })

  it('skips on ❌, even with ✅ and in auto mode', () => {
    expect(decide(hoy, { approved: true, rejected: true }, at(12), true, at(13))).toEqual({ action: 'skip', reason: { kind: 'rejected' } })
  })

  it('skips with no reaction by 17:00', () => {
    expect(decide(hoy, none, null, false, at(17))).toEqual({ action: 'skip', reason: { kind: 'no-approval', by: at(17) } })
  })

  it('takes a ✅ first seen by the tick right after 17:00, but not later', () => {
    expect(decide(hoy, yes, at(17, 5), false, at(17, 5))).toEqual({ action: 'publish' })
    expect(decide(hoy, yes, at(17, 20), false, at(17, 20)).action).toBe('skip')
  })

  it('auto mode publishes at the slot without a ✅', () => {
    expect(decide(hoy, none, null, true, at(16, 50))).toEqual({ action: 'wait' })
    expect(decide(hoy, none, null, true, at(17))).toEqual({ action: 'publish' })
  })
})

describe('Este finde (late ✅ until Friday 18:00)', () => {
  const finde = runWindow('finde', '2026-11-20')
  const thursday = (h: number) => baInstant('2026-11-19', h)
  const friday = (h: number, m = 0) => baInstant('2026-11-20', h, m)

  it('waits past its Thursday slot without a reaction', () => {
    expect(decide(finde, none, null, false, thursday(13))).toEqual({ action: 'wait' })
  })

  it('publishes a late ✅ before the cutoff', () => {
    expect(decide(finde, yes, friday(10), false, friday(10))).toEqual({ action: 'publish' })
  })

  it('skips a ✅ given after the cutoff', () => {
    expect(decide(finde, yes, friday(19), false, friday(19))).toEqual({ action: 'skip', reason: { kind: 'no-approval', by: friday(18) } })
  })

  it('still publishes a ✅ seen before the cutoff on a later retry', () => {
    expect(decide(finde, yes, friday(17), false, friday(20))).toEqual({ action: 'publish' })
  })
})

describe('reactions', () => {
  it("counts only Hanif's ✅ and ❌", () => {
    expect(readReactions([{ name: 'white_check_mark', users: ['U999'] }, { name: 'x', users: ['U999'] }])).toEqual(none)
    expect(readReactions([{ name: 'white_check_mark', users: ['U999', HANIF] }])).toEqual(yes)
    expect(readReactions([{ name: 'x', users: [HANIF] }])).toEqual(no)
    expect(readReactions(undefined)).toEqual(none)
  })
})

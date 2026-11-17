import { describe, expect, it } from 'vitest'
import { DIAGNOSTIC_TABLES, TABLES, liveCountProblems } from './lib.ts'

const exported = { events: 100, saved_events: 2, profiles: 4, guest_request_lifecycle: 230, guest_chat_debug: 98, rate_limit_windows: 4 }

describe('verify --production live counts', () => {
  it('tolerates growth in the diagnostic tables the old Workers write before the freeze', () => {
    const result = liveCountProblems(exported, { ...exported, guest_request_lifecycle: 231, guest_chat_debug: 99, rate_limit_windows: 5 })
    expect(result.problems).toEqual([])
    expect(result.tolerated).toHaveLength(3)
  })

  it('still fails any change to catalog or user data, and a shrink anywhere', () => {
    expect(liveCountProblems(exported, { ...exported, events: 101 }).problems).toEqual(['events: production has 101 rows, the export 100'])
    expect(liveCountProblems(exported, { ...exported, saved_events: 3 }).problems).toHaveLength(1)
    expect(liveCountProblems(exported, { ...exported, guest_chat_debug: 97 }).problems).toHaveLength(1)
  })

  it('names only real tables', () => {
    const names = new Set(TABLES.map(([table]) => table))
    for (const table of DIAGNOSTIC_TABLES) expect(names.has(table)).toBe(true)
  })
})

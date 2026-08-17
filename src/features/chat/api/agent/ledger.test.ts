import { describe, expect, it } from 'vitest'
import { Ledger } from './ledger.ts'
import { ledgerFrom, searchEntry, event } from './_test-helpers.ts'

describe('search stage aggregate outcomes (v5)', () => {
  it('success: all calls succeeded and at least one event returned', () => {
    const ledger = ledgerFrom([
      searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 1 }),
    ])
    expect(ledger.activeStage('req-1')?.outcome).toBe('success')
  })

  it('empty: all calls succeeded and all returned zero events', () => {
    const ledger = ledgerFrom([
      searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [], limit: 1 }),
    ])
    expect(ledger.activeStage('req-1')?.outcome).toBe('empty')
  })

  it('partial_success: at least one event and at least one failed call', () => {
    const ledger = ledgerFrom([
      searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 1 }),
      searchEntry({ stepIndex: 0, callIndex: 1, toolCallId: 's1', events: [], limit: 1, success: false }),
    ])
    expect(ledger.activeStage('req-1')?.outcome).toBe('partial_success')
  })

  it('partial_failure: zero events, one empty success, one failed call', () => {
    const ledger = ledgerFrom([
      searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [], limit: 1 }),
      searchEntry({ stepIndex: 0, callIndex: 1, toolCallId: 's1', events: [], limit: 1, success: false }),
    ])
    expect(ledger.activeStage('req-1')?.outcome).toBe('partial_failure')
  })

  it('failed: all calls failed', () => {
    const ledger = ledgerFrom([
      searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [], limit: 1, success: false }),
      searchEntry({ stepIndex: 0, callIndex: 1, toolCallId: 's1', events: [], limit: 1, success: false }),
    ])
    expect(ledger.activeStage('req-1')?.outcome).toBe('failed')
  })
})

import { describe, expect, it } from 'vitest'
import { recordToolResult, normalizeMutationOutcome, mutationMessage } from './record.ts'
import { ledgerFrom, searchEntry, event } from './_test-helpers.ts'
import { Ledger } from './ledger.ts'

function record(toolName: string, input: unknown, output: Record<string, unknown>, stepIndex = 0, callIndex = 0) {
  return recordToolResult(
    'req-1',
    {
      toolCallId: `call-${stepIndex}-${callIndex}`,
      toolName,
      input,
      output,
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(1000).toISOString(),
      success: output.success !== false,
    },
    stepIndex,
    callIndex,
    'en'
  )
}

describe('recordToolResult', () => {
  it('extracts search events and search input', () => {
    const entry = record('search_events', { query: 'tango' }, {
      success: true,
      events: [event('e1', 'Tango')],
      metadata: { resultCount: 1, coverage: { searchedTo: null, maxEventDate: null }, toolInput: { query: 'tango', limit: 1 } },
    })
    expect(entry.kind).toBe('search')
    expect(entry.events.map((e) => e.id)).toEqual(['e1'])
    expect(entry.searchInput?.query).toBe('tango')
  })

  it('normalizes save outcomes deterministically', () => {
    expect(normalizeMutationOutcome('save_event', { success: true })).toBe('applied')
    expect(normalizeMutationOutcome('save_event', { success: true, error: 'already_saved' })).toBe('already_applied')
    expect(normalizeMutationOutcome('save_event', { success: false, error: 'not_authenticated' })).toBe('unauthenticated')
    expect(normalizeMutationOutcome('save_event', { success: false, error: 'event_not_found' })).toBe('not_found')
    expect(normalizeMutationOutcome('unsave_event', { success: false, error: 'not_saved' })).toBe('already_applied')
    expect(normalizeMutationOutcome('unsave_event', { success: false, error: 'unknown_error' })).toBe('failed')
  })

  it('builds a mutation receipt with a deterministic message', () => {
    const entry = record('save_event', { eventId: 'e1' }, {
      success: false,
      error: 'not_authenticated',
      formatted: JSON.stringify({ message: 'login needed' }),
    })
    expect(entry.kind).toBe('mutation')
    expect(entry.receipt?.outcome).toBe('unauthenticated')
    expect(entry.receipt?.message).toBe('login needed')
    expect(entry.authRequired).toBe(true)
  })

  it('falls back to a deterministic localized message when formatted is absent', () => {
    const entry = record('save_event', { eventId: 'e1' }, { success: true })
    expect(entry.receipt?.message).toBe('Saved it to your list.')
    expect(mutationMessage('save_event', 'applied', 'es')).toBe('Lo guardé en tu lista.')
  })

  it('classifies an unauthenticated list_saved_events as an auth-requirement artifact', () => {
    const entry = record('list_saved_events', { filter: 'all' }, { success: false, error: 'not_authenticated' })
    expect(entry.kind).toBe('auth-requirement')
    expect(entry.authRequired).toBe(true)
  })

  it('classifies check_event_saved as its own non-display status artifact', () => {
    const entry = record('check_event_saved', { eventId: 'e1' }, { success: true, metadata: { isSaved: true } })
    expect(entry.kind).toBe('check-saved')
    expect(entry.events).toEqual([])
  })

  it('preserves model call order regardless of completion order (parallel reverse)', () => {
    // Call order is a0, b0, c0; results are recorded out of order by the ledger
    // consumer — the Ledger keeps insertion order which the work loop drives
    // from step.toolCalls (model order), never toolResults order.
    const ledger = new Ledger()
    ledger.push(searchEntry({ stepIndex: 0, callIndex: 2, toolCallId: 'c', events: [event('c', 'C')] }))
    ledger.push(searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 'a', events: [event('a', 'A')] }))
    ledger.push(searchEntry({ stepIndex: 0, callIndex: 1, toolCallId: 'b', events: [event('b', 'B')] }))
    const sorted = ledger.successfulSearches().sort((x, y) => x.callIndex - y.callIndex)
    expect(sorted.map((e) => e.events[0].id)).toEqual(['a', 'b', 'c'])
  })
})

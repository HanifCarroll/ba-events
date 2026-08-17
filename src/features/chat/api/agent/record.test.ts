import { describe, expect, it } from 'vitest'
import {
  recordToolResult,
  normalizeMutationOutcome,
  mutationMessage,
  mutationSavedState,
  resolveSavedState,
} from './record.ts'
import { searchEntry, event, mutationEntry, checkSavedEntry } from './_test-helpers.ts'
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

describe('recordToolResult (v4)', () => {
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

  it('builds a mutation receipt from structured fields only — never formatted prose', () => {
    const entry = record('save_event', { eventId: 'e1' }, {
      success: false,
      error: 'not_authenticated',
      formatted: JSON.stringify({ message: 'login needed (untrusted prose)' }),
    })
    expect(entry.kind).toBe('mutation')
    expect(entry.receipt?.outcome).toBe('unauthenticated')
    // The `formatted` prose is ignored; the deterministic localized message wins.
    expect(entry.receipt?.message).toBe('You need to log in to save events.')
    expect(entry.authRequired).toBe(true)
  })

  it('falls back to a deterministic localized message when formatted is absent', () => {
    const entry = record('save_event', { eventId: 'e1' }, { success: true })
    expect(entry.receipt?.message).toBe('Saved it to your list.')
    expect(mutationMessage('save_event', 'applied', 'es')).toBe('Lo guardé en tu lista.')
  })

  it('exposes a complete EN and Argentine ES message table (no empty cells)', () => {
    const outcomes = ['applied', 'already_applied', 'denied', 'unauthenticated', 'not_found', 'failed'] as const
    for (const locale of ['en', 'es'] as const) {
      for (const toolName of ['save_event', 'unsave_event'] as const) {
        for (const outcome of outcomes) {
          const message = mutationMessage(toolName, outcome, locale)
          expect(message.trim().length).toBeGreaterThan(0)
          expect(message).not.toContain('undefined')
        }
      }
    }
    // Distinct semantics per outcome and tool — the applied text is not the failed text.
    expect(mutationMessage('save_event', 'applied', 'en')).not.toBe(mutationMessage('save_event', 'failed', 'en'))
    expect(mutationMessage('unsave_event', 'applied', 'en')).not.toBe(mutationMessage('save_event', 'applied', 'en'))
    expect(mutationMessage('unsave_event', 'applied', 'es')).toBe('Lo saqué de tus guardados.')
    expect(mutationMessage('save_event', 'unauthenticated', 'es')).toBe('Tenés que iniciar sesión para guardar eventos.')
  })

  it('classifies an unauthenticated list_saved_events as an auth-requirement artifact', () => {
    const entry = record('list_saved_events', { filter: 'all' }, { success: false, error: 'not_authenticated' })
    expect(entry.kind).toBe('auth-requirement')
    expect(entry.authRequired).toBe(true)
  })

  it('classifies check_event_saved as a typed {eventId, isSaved} artifact', () => {
    const entry = record('check_event_saved', { eventId: 'e1' }, { success: true, metadata: { isSaved: true } })
    expect(entry.kind).toBe('check-saved')
    expect(entry.checkSaved).toEqual({ eventId: 'e1', isSaved: true })
    expect(entry.events).toEqual([])
  })

  it('records a successful retain_search_results structurally', () => {
    const entry = record('retain_search_results', { sourceToolCallIds: ['s0'] }, { success: true, retained: ['s0'] })
    expect(entry.kind).toBe('retention')
    expect(entry.success).toBe(true)
    expect(entry.retainedToolCallIds).toEqual(['s0'])
  })

  it('does not record retained ids for a failed retention call', () => {
    const entry = record('retain_search_results', { sourceToolCallIds: ['s0'] }, { success: false, error: 'invalid_retention' })
    expect(entry.kind).toBe('retention')
    expect(entry.success).toBe(false)
    expect(entry.retainedToolCallIds).toEqual([])
  })

  it('derives tri-state saved from mutation outcomes (failed/denied never overwrite)', () => {
    expect(mutationSavedState('save_event', 'applied')).toBe(true)
    expect(mutationSavedState('save_event', 'already_applied')).toBe(true)
    expect(mutationSavedState('unsave_event', 'applied')).toBe(false)
    expect(mutationSavedState('unsave_event', 'already_applied')).toBe(false)
    expect(mutationSavedState('save_event', 'failed')).toBeNull()
    expect(mutationSavedState('save_event', 'unauthenticated')).toBeNull()
    expect(mutationSavedState('save_event', 'not_found')).toBeNull()
  })

  it('resolves saved state: check-saved → mutation → prior → unknown', () => {
    const ledger = new Ledger()
    const search = searchEntry({ toolCallId: 's0', events: [event('e1', 'One')] })
    ledger.push(search)
    expect(resolveSavedState('e1', ledger, 'req-1')).toBeNull()

    ledger.push(mutationEntry({ toolCallId: 'm0', toolName: 'save_event', eventId: 'e1', outcome: 'applied' }))
    expect(resolveSavedState('e1', ledger, 'req-1')).toBe(true)

    const check = checkSavedEntry({ toolCallId: 'cs0', eventId: 'e1', isSaved: false })
    ledger.push(check)
    expect(resolveSavedState('e1', ledger, 'req-1')).toBe(false)
  })

  it('chronology: save then unsave → false (latest successful wins)', () => {
    const ledger = new Ledger()
    ledger.push(searchEntry({ toolCallId: 's0', events: [event('e1', 'One')] }))
    ledger.push(mutationEntry({ toolCallId: 'm1', toolName: 'save_event', eventId: 'e1', outcome: 'applied', stepIndex: 0, callIndex: 1 }))
    ledger.push(mutationEntry({ toolCallId: 'm2', toolName: 'unsave_event', eventId: 'e1', outcome: 'applied', stepIndex: 0, callIndex: 2 }))
    expect(resolveSavedState('e1', ledger, 'req-1')).toBe(false)
  })

  it('chronology: unsave then save → true', () => {
    const ledger = new Ledger()
    ledger.push(searchEntry({ toolCallId: 's0', events: [event('e1', 'One')] }))
    ledger.push(mutationEntry({ toolCallId: 'm1', toolName: 'unsave_event', eventId: 'e1', outcome: 'applied', stepIndex: 0, callIndex: 1 }))
    ledger.push(mutationEntry({ toolCallId: 'm2', toolName: 'save_event', eventId: 'e1', outcome: 'applied', stepIndex: 0, callIndex: 2 }))
    expect(resolveSavedState('e1', ledger, 'req-1')).toBe(true)
  })

  it('chronology: check then mutation → mutation wins', () => {
    const ledger = new Ledger()
    ledger.push(searchEntry({ toolCallId: 's0', events: [event('e1', 'One')] }))
    ledger.push(checkSavedEntry({ toolCallId: 'cs0', eventId: 'e1', isSaved: true, stepIndex: 0, callIndex: 1 }))
    ledger.push(mutationEntry({ toolCallId: 'm1', toolName: 'unsave_event', eventId: 'e1', outcome: 'applied', stepIndex: 1, callIndex: 0 }))
    expect(resolveSavedState('e1', ledger, 'req-1')).toBe(false)
  })

  it('chronology: mutation then check → check wins', () => {
    const ledger = new Ledger()
    ledger.push(searchEntry({ toolCallId: 's0', events: [event('e1', 'One')] }))
    ledger.push(mutationEntry({ toolCallId: 'm1', toolName: 'save_event', eventId: 'e1', outcome: 'applied', stepIndex: 0, callIndex: 1 }))
    ledger.push(checkSavedEntry({ toolCallId: 'cs0', eventId: 'e1', isSaved: false, stepIndex: 1, callIndex: 0 }))
    expect(resolveSavedState('e1', ledger, 'req-1')).toBe(false)
  })

  it('failed/denied/unauth/not_found do not overwrite the latest known value', () => {
    const ledger = new Ledger()
    ledger.push(searchEntry({ toolCallId: 's0', events: [event('e1', 'One')] }))
    ledger.push(mutationEntry({ toolCallId: 'm1', toolName: 'save_event', eventId: 'e1', outcome: 'applied', stepIndex: 0, callIndex: 1 }))
    ledger.push(mutationEntry({ toolCallId: 'm2', toolName: 'save_event', eventId: 'e1', outcome: 'failed', stepIndex: 1, callIndex: 0 }))
    expect(resolveSavedState('e1', ledger, 'req-1')).toBe(true)
  })

  it('preserves model call order regardless of completion order (parallel reverse)', () => {
    const ledger = new Ledger()
    ledger.push(searchEntry({ stepIndex: 0, callIndex: 2, toolCallId: 'c', events: [event('c', 'C')] }))
    ledger.push(searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 'a', events: [event('a', 'A')] }))
    ledger.push(searchEntry({ stepIndex: 0, callIndex: 1, toolCallId: 'b', events: [event('b', 'B')] }))
    const sorted = ledger.successfulSearches().sort((x, y) => x.callIndex - y.callIndex)
    expect(sorted.map((e) => e.events[0].id)).toEqual(['a', 'b', 'c'])
  })

  it('records directions with event/venue identity', () => {
    const entry = record('get_directions', { eventId: 'e1' }, {
      success: true,
      directions: { venueName: 'Niceto', address: 'x', mapsUrl: 'https://maps', eventId: 'e1' },
    })
    expect(entry.kind).toBe('directions')
    expect(entry.directions?.eventId).toBe('e1')
  })
})

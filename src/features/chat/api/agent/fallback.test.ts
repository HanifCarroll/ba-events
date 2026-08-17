import { describe, expect, it } from 'vitest'
import { buildFallback } from './fallback.ts'
import {
  ledgerFrom,
  searchEntry,
  mutationEntry,
  directionsEntry,
  eventDetailsEntry,
  savedEventsEntry,
  venueDetailsEntry,
  event,
} from './_test-helpers.ts'

const base = {
  requestId: 'req-1',
  locale: 'en' as const,
  reason: 'invalid_schema' as const,
  requestedCount: 5,
}

describe('buildFallback', () => {
  it('uses only the highest search step, in call order then result order', () => {
    const step0 = searchEntry({
      stepIndex: 0,
      callIndex: 0,
      toolCallId: 's0',
      events: [event('old1', 'Old one'), event('old2', 'Old two')],
      limit: 3,
    })
    const step1a = searchEntry({
      stepIndex: 1,
      callIndex: 0,
      toolCallId: 's1a',
      events: [event('a', 'A'), event('b', 'B')],
      limit: 3,
    })
    const step1b = searchEntry({
      stepIndex: 1,
      callIndex: 1,
      toolCallId: 's1b',
      events: [event('a', 'A'), event('c', 'C')],
      limit: 3,
    })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([step0, step1a, step1b]) })
    expect(canonical.kind).toBe('recommendations')
    expect(canonical.events.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(canonical.provenance.sourceToolCallIds).toEqual(['s1a', 's1b'])
    expect(canonical.provenance.origin).toBe('fallback')
  })

  it('shows no cards when the latest search step is empty and never resurrects earlier results', () => {
    const step0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('old', 'Old')], limit: 3 })
    const step1 = searchEntry({ stepIndex: 1, toolCallId: 's1', events: [], limit: 3 })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([step0, step1]) })
    expect(canonical.events).toEqual([])
    expect(canonical.kind).toBe('no_results')
  })

  it('ignores artifacts from a different request', () => {
    const current = searchEntry({
      stepIndex: 0,
      toolCallId: 'current',
      events: [event('a', 'Current')],
      limit: 1,
    })
    const foreign = searchEntry({
      stepIndex: 1,
      toolCallId: 'foreign',
      events: [event('b', 'Foreign')],
      limit: 1,
    })
    foreign.requestId = 'other-request'
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([current, foreign]) })
    expect(canonical.events.map((e) => e.id)).toEqual(['a'])
    expect(canonical.provenance.sourceToolCallIds).toEqual(['current'])
  })

  it('caps discovery results at the requested count', () => {
    const search = searchEntry({
      stepIndex: 0,
      toolCallId: 's0',
      events: [event('a', 'A'), event('b', 'B'), event('c', 'C')],
      limit: 3,
    })
    const canonical = buildFallback({ ...base, requestedCount: 2, ledger: ledgerFrom([search]) })
    expect(canonical.events.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('preserves deduped mutation receipts and marks fallback', () => {
    const m1 = mutationEntry({ toolCallId: 'm1', toolName: 'save_event', eventId: 'a', outcome: 'applied' })
    const m1dup = mutationEntry({ toolCallId: 'm2', toolName: 'save_event', eventId: 'a', outcome: 'applied' })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([m1, m1dup]) })
    expect(canonical.operations).toHaveLength(1)
    expect(canonical.kind).toBe('mutation_result')
    expect(canonical.provenance.fallbackUsed).toBe(true)
    expect(canonical.provenance.fallbackReason).toBe('invalid_schema')
    expect(canonical.provenance.origin).toBe('fallback')
  })

  it('uses the relevant directions artifact', () => {
    const dir = directionsEntry({ toolCallId: 'd1', venueName: 'Niceto' })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([dir]) })
    expect(canonical.directions?.venueName).toBe('Niceto')
    expect(canonical.kind).toBe('directions')
    expect(canonical.provenance.directionToolCallIds).toEqual(['d1'])
  })

  it('uses the latest successful direction when multiple exist', () => {
    const d0 = directionsEntry({ toolCallId: 'd0', venueName: 'First', stepIndex: 0, callIndex: 0 })
    const d1 = directionsEntry({ toolCallId: 'd1', venueName: 'Second', stepIndex: 1, callIndex: 0 })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([d0, d1]) })
    expect(canonical.directions?.venueName).toBe('Second')
    expect(canonical.provenance.directionToolCallIds).toEqual(['d1'])
  })

  it('produces the exact discovery fallback text', () => {
    const search = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('a', 'Tango night')], limit: 1 })
    const en = buildFallback({ ...base, ledger: ledgerFrom([search]) })
    expect(en.text).toBe('Here are the best matches I found.')
    const es = buildFallback({ ...base, locale: 'es', ledger: ledgerFrom([search]) })
    expect(es.text).toBe('Estas son las mejores opciones que encontré.')
  })

  it('preserves mutations plus the final read without unioning unrelated read types', () => {
    const search = searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 3 })
    const mutation = mutationEntry({ stepIndex: 0, callIndex: 1, toolCallId: 'm1', toolName: 'save_event', eventId: 'a', outcome: 'applied' })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([search, mutation]) })
    expect(canonical.kind).toBe('recommendations')
    expect(canonical.operations).toHaveLength(1)
    expect(canonical.events.map((e) => e.id)).toEqual(['a'])
  })

  it('prefers the final relevant read: search then saved → saved_events', () => {
    const search = searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 3 })
    const saved = savedEventsEntry({ stepIndex: 1, callIndex: 0, toolCallId: 'sv0', events: [event('b', 'Saved B')] })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([search, saved]) })
    expect(canonical.kind).toBe('saved_events')
    expect(canonical.events.map((e) => e.id)).toEqual(['b'])
  })

  it('prefers the final relevant read: saved then search → recommendations', () => {
    const saved = savedEventsEntry({ stepIndex: 0, callIndex: 0, toolCallId: 'sv0', events: [event('b', 'Saved B')] })
    const search = searchEntry({ stepIndex: 1, callIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 3 })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([saved, search]) })
    expect(canonical.kind).toBe('recommendations')
    expect(canonical.events.map((e) => e.id)).toEqual(['a'])
  })

  it('prefers the final relevant read: details then search → recommendations, search then details → event_details', () => {
    const details = eventDetailsEntry({ toolCallId: 'd0', eventId: 'x', name: 'X', stepIndex: 0, callIndex: 0 })
    const search = searchEntry({ stepIndex: 1, callIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 3 })
    expect(buildFallback({ ...base, ledger: ledgerFrom([details, search]) }).kind).toBe('recommendations')

    const search0 = searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 3 })
    const details1 = eventDetailsEntry({ toolCallId: 'd1', eventId: 'x', name: 'X', stepIndex: 1, callIndex: 0 })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([search0, details1]) })
    expect(canonical.kind).toBe('event_details')
    expect(canonical.events.map((e) => e.id)).toEqual(['x'])
  })

  it('pinned fallback prefers only the exact pinned details artifact', () => {
    const pinned = eventDetailsEntry({ toolCallId: 'd0', eventId: 'pin', name: 'Pinned', stepIndex: 0, callIndex: 0 })
    const search = searchEntry({ stepIndex: 1, callIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 3 })
    const canonical = buildFallback({ ...base, pinnedEventId: 'pin', ledger: ledgerFrom([pinned, search]) })
    expect(canonical.kind).toBe('event_details')
    expect(canonical.events.map((e) => e.id)).toEqual(['pin'])
  })

  it('pinned fallback with a missing pinned artifact shows no alternate event', () => {
    const search = searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 3 })
    const canonical = buildFallback({ ...base, pinnedEventId: 'pin', ledger: ledgerFrom([search]) })
    expect(canonical.events).toEqual([])
  })

  it('venue-details fallback uses the final venue artifact', () => {
    const venue = venueDetailsEntry({ toolCallId: 'v0', venueName: 'Niceto' })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([venue]) })
    expect(canonical.kind).toBe('venue_details')
    expect(canonical.venue?.venueName).toBe('Niceto')
    expect(canonical.provenance.venueToolCallIds).toEqual(['v0'])
  })

  it('a successful saved-events read with zero events becomes no_results, not saved_events', () => {
    const saved = savedEventsEntry({ toolCallId: 'sv0', events: [] })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([saved]) })
    expect(canonical.kind).toBe('no_results')
    expect(canonical.events).toEqual([])
  })

  it('a malformed successful details artifact with no events yields a deterministic error', () => {
    const details = eventDetailsEntry({ toolCallId: 'd0', eventId: 'x', name: 'X' })
    details.events = []
    details.eventIds = []
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([details]) })
    expect(canonical.kind).toBe('error')
    expect(canonical.events).toEqual([])
    expect(canonical.directions).toBeNull()
    expect(canonical.venue).toBeNull()
  })

  it('a malformed successful directions artifact missing its payload yields error', () => {
    const dir = directionsEntry({ toolCallId: 'd0' })
    dir.directions = null
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([dir]) })
    expect(canonical.kind).toBe('error')
    expect(canonical.directions).toBeNull()
  })

  it('a malformed successful venue artifact missing its payload yields error', () => {
    const venue = venueDetailsEntry({ toolCallId: 'v0' })
    venue.venue = null
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([venue]) })
    expect(canonical.kind).toBe('error')
    expect(canonical.venue).toBeNull()
  })
})

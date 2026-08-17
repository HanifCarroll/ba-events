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
  checkSavedEntry,
  retentionEntry,
  rejectionEntry,
  event,
} from './_test-helpers.ts'

const base = {
  requestId: 'req-1',
  locale: 'en' as const,
  reason: 'invalid_schema' as const,
  requestedCount: 5,
}

describe('buildFallback (v4)', () => {
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
    expect(canonical.messageKey).toBe('recommendations')
    expect(canonical.events.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(canonical.provenance.sourceToolCallIds).toEqual(['s1a', 's1b'])
    expect(canonical.provenance.stageIds).toEqual(['stage-1'])
    expect(canonical.provenance.origin).toBe('fallback')
  })

  it('shows no cards when the latest search stage is empty and never resurrects earlier results', () => {
    const step0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('old', 'Old')], limit: 3 })
    const step1 = searchEntry({ stepIndex: 1, toolCallId: 's1', events: [], limit: 3 })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([step0, step1]) })
    expect(canonical.events).toEqual([])
    expect(canonical.kind).toBe('no_results')
    expect(canonical.provenance.emptySourceToolCallIds).toEqual(['s1'])
    expect(canonical.provenance.searchAttemptToolCallIds).toEqual(['s1'])
    expect(canonical.provenance.stageIds).toEqual(['stage-1'])
  })

  it('a failed-only active stage yields error, never no_results, never resurrects', () => {
    const step0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('old', 'Old')], limit: 3 })
    const step1 = searchEntry({ stepIndex: 1, toolCallId: 's1', events: [], limit: 3, success: false })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([step0, step1]) })
    expect(canonical.events).toEqual([])
    expect(canonical.kind).toBe('error')
    expect(canonical.provenance.searchAttemptToolCallIds).toEqual(['s1'])
    expect(canonical.provenance.stageIds).toEqual(['stage-1'])
  })

  it('a rejected earlier stage is never resurrected by a failed refinement', () => {
    const step0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('old', 'Old')], limit: 3 })
    const step1 = searchEntry({ stepIndex: 1, toolCallId: 's1', events: [], limit: 3, success: false })
    const rej = rejectionEntry({ toolCallId: 'rej0', rejectedToolCallIds: ['s0'], stepIndex: 1, callIndex: 1 })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([step0, step1, rej]) })
    expect(canonical.events).toEqual([])
    expect(canonical.kind).toBe('error')
  })

  it('a rejected earlier stage is never resurrected by an empty refinement', () => {
    const step0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('old', 'Old')], limit: 3 })
    const step1 = searchEntry({ stepIndex: 1, toolCallId: 's1', events: [], limit: 3 })
    const rej = rejectionEntry({ toolCallId: 'rej0', rejectedToolCallIds: ['s0'], stepIndex: 1, callIndex: 1 })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([step0, step1, rej]) })
    expect(canonical.events).toEqual([])
    expect(canonical.kind).toBe('no_results')
  })

  it('a rejected latest/only stage produces zero cards, never no_results', () => {
    const s0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('old', 'Old')], limit: 3 })
    const rej = rejectionEntry({ toolCallId: 'rej0', rejectedToolCallIds: ['s0'], stepIndex: 1, callIndex: 0 })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([s0, rej]) })
    expect(canonical.events).toEqual([])
    expect(canonical.kind).toBe('error')
  })

  it('a rejected latest empty stage does not ground no_results', () => {
    const s0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [], limit: 1 })
    const rej = rejectionEntry({ toolCallId: 'rej0', rejectedToolCallIds: ['s0'], stepIndex: 1, callIndex: 0 })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([s0, rej]) })
    expect(canonical.events).toEqual([])
    expect(canonical.kind).toBe('error')
  })

  it('reactivates an explicitly retained earlier search when the active stage is empty', () => {
    const step0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('old', 'Old')], limit: 3 })
    const step1 = searchEntry({ stepIndex: 1, toolCallId: 's1', events: [], limit: 3 })
    const ret = retentionEntry({ toolCallId: 'r0', retainedToolCallIds: ['s0'], stepIndex: 1, callIndex: 1 })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([step0, step1, ret]) })
    expect(canonical.kind).toBe('recommendations')
    expect(canonical.events.map((e) => e.id)).toEqual(['old'])
    expect(canonical.provenance.retainedSourceToolCallIds).toEqual(['s0'])
    expect(canonical.provenance.stageIds).toEqual(['stage-0'])
  })

  it('stage-scoped retention: a newer stage invalidates earlier retention', () => {
    const step0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('old', 'Old')], limit: 3 })
    const step1 = searchEntry({ stepIndex: 1, toolCallId: 's1', events: [], limit: 3 })
    // retention of s0 made during step 1 (active stage)
    const ret1 = retentionEntry({ toolCallId: 'r1', retainedToolCallIds: ['s0'], stepIndex: 1, callIndex: 1 })
    // step 2: a NEW search stage, with no new retention → s0 retention invalidated
    const step2 = searchEntry({ stepIndex: 2, toolCallId: 's2', events: [], limit: 3 })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([step0, step1, ret1, step2]) })
    expect(canonical.events).toEqual([])
    expect(canonical.kind).toBe('no_results')
    expect(canonical.provenance.retainedSourceToolCallIds).toEqual([])
  })

  it('stage-scoped retention: the newer stage can retain the source again', () => {
    const step0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('old', 'Old')], limit: 3 })
    const step1 = searchEntry({ stepIndex: 1, toolCallId: 's1', events: [], limit: 3 })
    const step2 = searchEntry({ stepIndex: 2, toolCallId: 's2', events: [], limit: 3 })
    const ret2 = retentionEntry({ toolCallId: 'r2', retainedToolCallIds: ['s0'], stepIndex: 2, callIndex: 1 })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([step0, step1, step2, ret2]) })
    expect(canonical.kind).toBe('recommendations')
    expect(canonical.events.map((e) => e.id)).toEqual(['old'])
    expect(canonical.provenance.retainedSourceToolCallIds).toEqual(['s0'])
  })

  it('ignores artifacts from a different request', () => {
    const current = searchEntry({ stepIndex: 0, toolCallId: 'current', events: [event('a', 'Current')], limit: 1 })
    const foreign = searchEntry({ stepIndex: 1, toolCallId: 'foreign', events: [event('b', 'Foreign')], limit: 1 })
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

  it('fallback never fabricates a mutation result (mutations are post-plan)', () => {
    // Mutation entries can no longer appear in a fallback ledger: the work loop
    // never executes save/unsave, and the executor runs only on the validated
    // path. A ledger with only stale mutation entries yields a deterministic
    // error, never a mutation_result.
    const m1 = mutationEntry({ toolCallId: 'm1', toolName: 'save_event', eventId: 'a', outcome: 'applied' })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([m1]) })
    expect(canonical.kind).toBe('error')
    expect(canonical.events).toEqual([])
    expect(canonical.provenance.fallbackUsed).toBe(true)
    expect(canonical.provenance.fallbackReason).toBe('invalid_schema')
    expect(canonical.provenance.origin).toBe('fallback')
  })

  it('uses the relevant directions artifact when tied to a resolved target', () => {
    const dir = directionsEntry({ toolCallId: 'd1', venueName: 'Niceto', venueId: 'v1' })
    const canonical = buildFallback({ ...base, resolvedVenueId: 'v1', ledger: ledgerFrom([dir]) })
    expect(canonical.directions?.venueName).toBe('Niceto')
    expect(canonical.kind).toBe('directions')
    expect(canonical.provenance.directionToolCallIds).toEqual(['d1'])
  })

  it('drops an unrelated standalone directions artifact without a resolved target', () => {
    const dir = directionsEntry({ toolCallId: 'd1', venueName: 'Niceto', eventId: 'unrelated' })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([dir]) })
    expect(canonical.directions).toBeNull()
    expect(canonical.kind).toBe('error')
  })

  it('uses the latest successful direction when multiple exist (tied to a resolved target)', () => {
    const d0 = directionsEntry({ toolCallId: 'd0', venueName: 'First', stepIndex: 0, callIndex: 0, venueId: 'v1' })
    const d1 = directionsEntry({ toolCallId: 'd1', venueName: 'Second', stepIndex: 1, callIndex: 0, venueId: 'v1' })
    const canonical = buildFallback({ ...base, resolvedVenueId: 'v1', ledger: ledgerFrom([d0, d1]) })
    expect(canonical.directions?.venueName).toBe('Second')
    expect(canonical.provenance.directionToolCallIds).toEqual(['d1'])
  })

  it('produces the exact discovery fallback text (deterministic, localized)', () => {
    const search = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('a', 'Tango night')], limit: 1 })
    const en = buildFallback({ ...base, ledger: ledgerFrom([search]) })
    expect(en.text).toBe('Here are the best matches I found.')
    const es = buildFallback({ ...base, locale: 'es', ledger: ledgerFrom([search]) })
    expect(es.text).toBe('Estas son las mejores opciones que encontré.')
  })

  it('never lets an event date or price enter the materialized text', () => {
    const ev = event('a', 'Tango night', { starts_at: '2026-08-20T22:00:00Z', price: 5000 })
    const search = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [ev], limit: 1 })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([search]) })
    expect(canonical.text).toBe('Here are the best matches I found.')
    expect(canonical.text).not.toContain('2026-08-20')
    expect(canonical.text).not.toContain('5000')
  })

  it('preserves mutations plus the final read without unioning unrelated read types', () => {
    const search = searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 3 })
    const mutation = mutationEntry({ stepIndex: 0, callIndex: 1, toolCallId: 'm1', toolName: 'save_event', eventId: 'a', outcome: 'applied' })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([search, mutation]) })
    expect(canonical.kind).toBe('recommendations')
    expect(canonical.operations).toHaveLength(1)
    expect(canonical.events.map((e) => e.id)).toEqual(['a'])
  })

  it('prefers the final events read: search then saved → saved_events', () => {
    const search = searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 3 })
    const saved = savedEventsEntry({ stepIndex: 1, callIndex: 0, toolCallId: 'sv0', events: [event('b', 'Saved B')] })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([search, saved]) })
    expect(canonical.kind).toBe('saved_events')
    expect(canonical.events.map((e) => e.id)).toEqual(['b'])
    expect(canonical.events[0].saved).toBe(true)
  })

  it('prefers the final events read: saved then search → recommendations', () => {
    const saved = savedEventsEntry({ stepIndex: 0, callIndex: 0, toolCallId: 'sv0', events: [event('b', 'Saved B')] })
    const search = searchEntry({ stepIndex: 1, callIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 3 })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([saved, search]) })
    expect(canonical.kind).toBe('recommendations')
    expect(canonical.events.map((e) => e.id)).toEqual(['a'])
  })

  it('attaches directions to a saved-list primary only when tied to a selected event', () => {
    const saved = savedEventsEntry({ stepIndex: 0, callIndex: 0, toolCallId: 'sv0', events: [event('a', 'A'), event('b', 'B')] })
    const dir = directionsEntry({ stepIndex: 1, callIndex: 0, toolCallId: 'dir0', eventId: 'a' })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([saved, dir]) })
    expect(canonical.kind).toBe('saved_events')
    expect(canonical.events.map((e) => e.id)).toEqual(['a', 'b'])
    expect(canonical.directions?.eventId).toBe('a')
  })

  it('prefers the final events read: details then search → recommendations, search then details → event_details', () => {
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

  it('pinned fallback shows directions to the pinned event when details are missing', () => {
    const dir = directionsEntry({ toolCallId: 'd0', eventId: 'pin' })
    const canonical = buildFallback({ ...base, pinnedEventId: 'pin', ledger: ledgerFrom([dir]) })
    expect(canonical.kind).toBe('directions')
    expect(canonical.events).toEqual([])
    expect(canonical.directions?.eventId).toBe('pin')
  })

  it('pinned fallback drops an unrelated directions artifact when the pinned details are missing', () => {
    const dir = directionsEntry({ toolCallId: 'd0', eventId: 'other' })
    const canonical = buildFallback({ ...base, pinnedEventId: 'pin', ledger: ledgerFrom([dir]) })
    expect(canonical.kind).toBe('error')
    expect(canonical.events).toEqual([])
    expect(canonical.directions).toBeNull()
  })

  it('venue-details fallback uses the final venue artifact tied to a resolved target', () => {
    const venue = venueDetailsEntry({ toolCallId: 'v0', venueName: 'Niceto', venueId: 'v1' })
    const canonical = buildFallback({ ...base, resolvedVenueId: 'v1', ledger: ledgerFrom([venue]) })
    expect(canonical.kind).toBe('venue_details')
    expect(canonical.venue?.venueName).toBe('Niceto')
    expect(canonical.provenance.venueToolCallIds).toEqual(['v0'])
  })

  it('drops an unrelated standalone venue artifact without a resolved target', () => {
    const venue = venueDetailsEntry({ toolCallId: 'v0', venueName: 'Niceto', venueId: 'v1' })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([venue]) })
    expect(canonical.venue).toBeNull()
    expect(canonical.kind).toBe('error')
  })

  it('a successful saved-events read with zero events becomes no_results, not saved_events', () => {
    const saved = savedEventsEntry({ toolCallId: 'sv0', events: [] })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([saved]) })
    expect(canonical.kind).toBe('no_results')
    expect(canonical.events).toEqual([])
    expect(canonical.provenance.emptySourceToolCallIds).toEqual(['sv0'])
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

  it('preserves mutually compatible compound reads: events + related directions + venue + mutation', () => {
    const search = searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('a', 'A', { venue_id: 'v1' })], limit: 1 })
    const dir = directionsEntry({ stepIndex: 1, callIndex: 0, toolCallId: 'dir0', eventId: 'a' })
    const venue = venueDetailsEntry({ stepIndex: 1, callIndex: 1, toolCallId: 'v0', venueId: 'v1' })
    const mutation = mutationEntry({ stepIndex: 1, callIndex: 2, toolCallId: 'm0', toolName: 'save_event', eventId: 'a', outcome: 'applied' })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([search, dir, venue, mutation]) })
    expect(canonical.kind).toBe('recommendations')
    expect(canonical.events.map((e) => e.id)).toEqual(['a'])
    expect(canonical.directions?.eventId).toBe('a')
    expect(canonical.venue?.venueId).toBe('v1')
    expect(canonical.operations).toHaveLength(1)
  })

  it('does not attach an unrelated directions artifact to a later events read', () => {
    const search = searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('a', 'A', { venue_id: 'v1' })], limit: 1 })
    const dir = directionsEntry({ stepIndex: 1, callIndex: 0, toolCallId: 'dir0', eventId: 'other' })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([search, dir]) })
    expect(canonical.kind).toBe('recommendations')
    expect(canonical.directions).toBeNull()
    expect(canonical.events.map((e) => e.id)).toEqual(['a'])
  })

  it('applies tri-state saved evidence to fallback events without erasing', () => {
    const search = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 1 })
    const check = checkSavedEntry({ toolCallId: 'cs0', eventId: 'a', isSaved: true })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([search, check]) })
    expect(canonical.events[0].saved).toBe(true)
  })

  it('a partial_success stage shows events with the incomplete lead and provenance', () => {
    const ok = searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 1 })
    const failed = searchEntry({ stepIndex: 0, callIndex: 1, toolCallId: 's1', events: [], limit: 1, success: false })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([ok, failed]) })
    expect(canonical.kind).toBe('recommendations')
    expect(canonical.messageKey).toBe('partial_results')
    expect(canonical.events.map((e) => e.id)).toEqual(['a'])
    expect(canonical.provenance.searchIncomplete).toBe(true)
    expect(canonical.text).toContain("part of the search didn't complete")
  })

  it('a partial_failure stage (no events, some failed) yields error, not no_results', () => {
    const empty = searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [], limit: 1 })
    const failed = searchEntry({ stepIndex: 0, callIndex: 1, toolCallId: 's1', events: [], limit: 1, success: false })
    const canonical = buildFallback({ ...base, ledger: ledgerFrom([empty, failed]) })
    expect(canonical.kind).toBe('error')
    expect(canonical.events).toEqual([])
    expect(canonical.messageKey).toBe('error')
  })
})

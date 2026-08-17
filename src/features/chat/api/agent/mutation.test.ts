import { describe, expect, it } from 'vitest'
import {
  planMutation,
  executeMutation,
  executeMutations,
  deriveMutationMessageKey,
} from './mutation.ts'
import type { OperationReceipt } from '#shared/lib/types.ts'

const ANON = { userId: null, isAuthenticated: false }

describe('planMutation (deterministic target authorization)', () => {
  it('returns none when there is no intent', () => {
    expect(planMutation({ intent: { kind: 'none' } })).toEqual({ status: 'none' })
  })

  it('resolves a prior-target mutation to the server-resolved event id', () => {
    const result = planMutation({
      intent: { kind: 'save', targetReference: { kind: 'ordinal', index: 1 } },
      resolvedEventId: 'D',
    })
    expect(result).toEqual({
      status: 'resolved',
      planned: { action: 'save', eventId: 'D', source: { kind: 'resolved_prior_target' } },
    })
  })

  it('resolves a current-search mutation to the selected event bound to its source', () => {
    const result = planMutation({
      intent: { kind: 'save', targetReference: { kind: 'none' } },
      selectedEventIds: ['tango'],
      selectedSourceToolCallIds: ['s1'],
    })
    expect(result).toEqual({
      status: 'resolved',
      planned: {
        action: 'save',
        eventId: 'tango',
        source: { kind: 'selected_current_event', sourceToolCallId: 's1' },
      },
    })
  })

  it('resolves a current_selection reference to the indexed current event', () => {
    const result = planMutation({
      intent: { kind: 'save', targetReference: { kind: 'current_selection', index: 1 } },
      selectedEventIds: ['a', 'b', 'c'],
      selectedSourceToolCallIds: ['s1', 's1', 's1'],
    })
    expect(result).toEqual({
      status: 'resolved',
      planned: {
        action: 'save',
        eventId: 'b',
        source: { kind: 'selected_current_event', sourceToolCallId: 's1' },
      },
    })
  })

  it('a current_selection index out of range is ambiguous (never prior group)', () => {
    const result = planMutation({
      intent: { kind: 'save', targetReference: { kind: 'current_selection', index: 4 } },
      selectedEventIds: ['a', 'b', 'c'],
      selectedSourceToolCallIds: ['s1', 's1', 's1'],
      resolvedEventId: 'PRIOR',
    })
    expect(result).toEqual({ status: 'ambiguous' })
  })

  it('resolves a pinned mutation to the pinned event id', () => {
    const result = planMutation({
      intent: { kind: 'unsave', targetReference: { kind: 'none' } },
      pinnedEventId: 'pin',
    })
    expect(result).toEqual({
      status: 'resolved',
      planned: { action: 'unsave', eventId: 'pin', source: { kind: 'pinned_event' } },
    })
  })

  it('a lead pronoun while pinned targets the pin', () => {
    const result = planMutation({
      intent: { kind: 'save', targetReference: { kind: 'lead' } },
      pinnedEventId: 'pin',
    })
    expect(result).toEqual({
      status: 'resolved',
      planned: { action: 'save', eventId: 'pin', source: { kind: 'pinned_event' } },
    })
  })

  it('an exact named reference to the pin targets the pin', () => {
    const result = planMutation({
      intent: { kind: 'save', targetReference: { kind: 'named_event', eventId: 'pin' } },
      pinnedEventId: 'pin',
    })
    expect(result).toEqual({
      status: 'resolved',
      planned: { action: 'save', eventId: 'pin', source: { kind: 'pinned_event' } },
    })
  })

  it('an ordinal reference to another event while pinned is never silently pinned', () => {
    const result = planMutation({
      intent: { kind: 'save', targetReference: { kind: 'ordinal', index: 1 } },
      pinnedEventId: 'pin',
      resolvedEventId: 'OTHER',
    })
    expect(result).toEqual({ status: 'ambiguous' })
  })

  it('a named_event reference to another event while pinned is never silently pinned', () => {
    const result = planMutation({
      intent: { kind: 'save', targetReference: { kind: 'named_event', eventId: 'OTHER' } },
      pinnedEventId: 'pin',
    })
    expect(result).toEqual({ status: 'ambiguous' })
  })

  it('never authorizes a named-venue reference (a venue is not an event)', () => {
    const result = planMutation({
      intent: { kind: 'save', targetReference: { kind: 'named_venue', venueId: 'v1' } },
    })
    expect(result).toEqual({ status: 'ambiguous' })
  })

  it('is ambiguous when an ordinal cannot resolve to a prior event', () => {
    const result = planMutation({
      intent: { kind: 'save', targetReference: { kind: 'ordinal', index: 1 } },
      // resolvedEventId missing: no prior group resolved the ordinal.
    })
    expect(result).toEqual({ status: 'ambiguous' })
  })

  it('is ambiguous when there is no selected current event for a reference-free mutation', () => {
    const result = planMutation({
      intent: { kind: 'save', targetReference: { kind: 'none' } },
    })
    expect(result).toEqual({ status: 'ambiguous' })
  })

  it('is ambiguous for an explicitly ambiguous reference', () => {
    const result = planMutation({
      intent: { kind: 'save', targetReference: { kind: 'ambiguous' } },
      resolvedEventId: 'D',
    })
    expect(result).toEqual({ status: 'ambiguous' })
  })
})

describe('executeMutation / executeMutations (exactly-once, truthful)', () => {
  it('an anonymous context yields an unauthenticated receipt without any DB access', async () => {
    const receipt = await executeMutation(
      { action: 'save', eventId: 'e1', source: { kind: 'resolved_prior_target' } },
      ANON,
      'en'
    )
    expect(receipt.outcome).toBe('unauthenticated')
    expect(receipt.toolName).toBe('save_event')
    expect(receipt.eventId).toBe('e1')
  })

  it('dedupes duplicate actions by action:eventId, executing once', async () => {
    const planned = [
      { action: 'save' as const, eventId: 'e1', source: { kind: 'resolved_prior_target' as const } },
      { action: 'save' as const, eventId: 'e1', source: { kind: 'resolved_prior_target' as const } },
    ]
    const receipts = await executeMutations(planned, ANON, 'en')
    expect(receipts).toHaveLength(1)
  })

  it('distinguishes save from unsave (not interchangeable)', async () => {
    const save = await executeMutation(
      { action: 'save', eventId: 'e1', source: { kind: 'resolved_prior_target' } },
      ANON,
      'en'
    )
    const unsave = await executeMutation(
      { action: 'unsave', eventId: 'e1', source: { kind: 'resolved_prior_target' } },
      ANON,
      'en'
    )
    expect(save.toolName).toBe('save_event')
    expect(unsave.toolName).toBe('unsave_event')
  })
})

describe('deriveMutationMessageKey (truthful leads)', () => {
  function receipt(outcome: OperationReceipt['outcome']): OperationReceipt {
    return { toolCallId: 'm', toolName: 'save_event', eventId: 'e1', outcome, message: 'x' }
  }

  it('maps applied to the success lead', () => {
    expect(deriveMutationMessageKey([receipt('applied')])).toBe('mutation_applied')
  })

  it('maps already_applied without claiming a new update', () => {
    expect(deriveMutationMessageKey([receipt('already_applied')])).toBe('mutation_already_applied')
  })

  it('maps unauthenticated / not_found / failed to their distinct keys', () => {
    expect(deriveMutationMessageKey([receipt('unauthenticated')])).toBe('mutation_unauthenticated')
    expect(deriveMutationMessageKey([receipt('not_found')])).toBe('mutation_not_found')
    expect(deriveMutationMessageKey([receipt('failed')])).toBe('mutation_failed')
  })

  it('mixed outcomes use the neutral lead', () => {
    expect(deriveMutationMessageKey([receipt('applied'), receipt('failed')])).toBe('mutation_mixed')
  })
})

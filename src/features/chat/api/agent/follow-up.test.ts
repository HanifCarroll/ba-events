import { describe, expect, it } from 'vitest'
import { priorEventsFromUIMessages, priorEventsFromCanonical, formatPriorEvents } from './follow-up.ts'
import type { CanonicalChatResponse } from '#shared/lib/types.ts'
import { CHAT_CONTRACT_VERSION } from '#shared/lib/types.ts'

function canonical(events: Array<{ id: string; name: string }>, operations: CanonicalChatResponse['operations'] = []): CanonicalChatResponse {
  return {
    contractVersion: CHAT_CONTRACT_VERSION,
    requestId: 'req',
    kind: 'recommendations',
    text: 'here',
    events: events.map((e) => ({ ...e })) as CanonicalChatResponse['events'],
    directions: null,
    venue: null,
    operations,
    suggestions: [],
    provenance: {
      sourceToolCallIds: [],
      directionToolCallIds: [],
      venueToolCallIds: [],
      mutationToolCallIds: [],
      suggestionToolCallIds: [],
      origin: 'validated',
      fallbackUsed: false,
      fallbackReason: null,
    },
  }
}

describe('follow-up context', () => {
  it('extracts prior displayed events from retained data-response parts', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'find jazz' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'here' },
          { type: 'data-response', data: canonical([{ id: 'e1', name: 'Jazz' }, { id: 'e2', name: 'Tango' }]) },
        ],
      },
    ] as never[]
    const prior = priorEventsFromUIMessages(messages as never)
    expect(prior.map((e) => e.eventId)).toEqual(['e1', 'e2'])
  })

  it('tracks saved state from mutation operations', () => {
    const prior = priorEventsFromCanonical([
      canonical([{ id: 'e1', name: 'Jazz' }], [
        { toolCallId: 'm1', toolName: 'save_event', eventId: 'e1', outcome: 'applied', message: 'saved' },
      ]),
    ])
    expect(prior[0].saved).toBe(true)
  })

  it('marks saved=true for already_applied, not for denied/not_found/failed/unauthenticated', () => {
    const prior = priorEventsFromCanonical([
      canonical([{ id: 'e1', name: 'Jazz' }], [
        { toolCallId: 'm1', toolName: 'save_event', eventId: 'e1', outcome: 'already_applied', message: 'already saved' },
      ]),
      canonical([{ id: 'e2', name: 'Denied' }], [
        { toolCallId: 'm2', toolName: 'save_event', eventId: 'e2', outcome: 'denied', message: 'denied' },
      ]),
      canonical([{ id: 'e3', name: 'Missing' }], [
        { toolCallId: 'm3', toolName: 'save_event', eventId: 'e3', outcome: 'not_found', message: 'not found' },
      ]),
      canonical([{ id: 'e4', name: 'Failed' }], [
        { toolCallId: 'm4', toolName: 'save_event', eventId: 'e4', outcome: 'failed', message: 'failed' },
      ]),
      canonical([{ id: 'e5', name: 'Auth' }], [
        { toolCallId: 'm5', toolName: 'save_event', eventId: 'e5', outcome: 'unauthenticated', message: 'login' },
      ]),
    ])
    const byId = new Map(prior.map((e) => [e.eventId, e.saved]))
    expect(byId.get('e1')).toBe(true)
    expect(byId.get('e2')).toBe(false)
    expect(byId.get('e3')).toBe(false)
    expect(byId.get('e4')).toBe(false)
    expect(byId.get('e5')).toBe(false)
  })

  it('formats prior events compactly', () => {
    expect(formatPriorEvents(priorEventsFromCanonical([canonical([{ id: 'e1', name: 'Jazz' }])]))).toContain('e1')
  })

  it('numbers prior events so "save the second one" resolves deterministically', () => {
    const formatted = formatPriorEvents(
      priorEventsFromCanonical([canonical([{ id: 'e1', name: 'Jazz' }, { id: 'e2', name: 'Tango' }])])
    )
    expect(formatted).toContain('1. e1: Jazz')
    expect(formatted).toContain('2. e2: Tango')
  })

  it('moves a re-displayed event to its latest position', () => {
    const prior = priorEventsFromCanonical([
      canonical([{ id: 'e1', name: 'Jazz' }, { id: 'e2', name: 'Tango' }]),
      canonical([{ id: 'e1', name: 'Jazz' }]),
    ])
    expect(prior.map((e) => e.eventId)).toEqual(['e2', 'e1'])
  })

  it('applies operation state from a later mutation-only response', () => {
    const prior = priorEventsFromCanonical([
      canonical([{ id: 'e1', name: 'Jazz' }], [
        { toolCallId: 'm1', toolName: 'save_event', eventId: 'e1', outcome: 'applied', message: 'saved' },
      ]),
      {
        ...canonical([]),
        kind: 'mutation_result' as const,
        operations: [
          { toolCallId: 'm2', toolName: 'unsave_event', eventId: 'e1', outcome: 'applied', message: 'removed' },
        ],
      },
    ])
    expect(prior[0].eventId).toBe('e1')
    expect(prior[0].saved).toBe(false)
  })

  it('bounds prior events to 20', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `e${i}`, name: `Event ${i}` }))
    const prior = priorEventsFromCanonical([canonical(many)])
    expect(prior).toHaveLength(20)
    expect(prior[0].eventId).toBe('e5')
  })
})

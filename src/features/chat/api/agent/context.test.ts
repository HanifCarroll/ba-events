import { describe, expect, it } from 'vitest'
import {
  detectMutationIntent,
  resolveReferences,
  buildApplicationContextMessage,
  buildConversationModelMessages,
  MAX_APPLICATION_CONTEXT_CHARS,
} from './context.ts'
import type { PriorDisplayGroup, PriorDisplayEvent } from './follow-up.ts'
import type { UIMessage } from 'ai'

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

const A = uuid(1)
const B = uuid(2)
const C = uuid(3)
const D = uuid(4)
const E = uuid(5)

function group(events: Array<[string, string]>, saved?: boolean | null): PriorDisplayGroup {
  return {
    assistantMessageId: 'm',
    requestId: 'req',
    createdAt: null,
    events: events.map(([eventId, name]): PriorDisplayEvent => ({ eventId, name, saved: saved ?? null })),
  }
}

describe('detectMutationIntent', () => {
  it('false for a benign ordinal/details request', () => {
    expect(detectMutationIntent('tell me about the second one')).toBe(false)
    expect(detectMutationIntent('show me details on the first one')).toBe(false)
    expect(detectMutationIntent('what else is happening this weekend')).toBe(false)
  })

  it('false for an injection-like event name in a benign query', () => {
    // The injected name lives in prior context, never in the user query text.
    expect(detectMutationIntent('tell me about the second one')).toBe(false)
  })

  it('true for English save/unsave asks', () => {
    expect(detectMutationIntent('save the second one')).toBe(true)
    expect(detectMutationIntent('bookmark it')).toBe(true)
    expect(detectMutationIntent('add it to my list')).toBe(true)
    expect(detectMutationIntent('I want to go to that')).toBe(true)
    expect(detectMutationIntent('remove it from my list')).toBe(true)
  })

  it('true for Spanish save/unsave asks', () => {
    expect(detectMutationIntent('guardá el segundo')).toBe(true)
    expect(detectMutationIntent('agregalo a mi lista')).toBe(true)
    expect(detectMutationIntent('quitá el primero')).toBe(true)
    expect(detectMutationIntent('sacá ese evento')).toBe(true)
  })
})

describe('resolveReferences', () => {
  it('resolves "save the second one" to D across A,B then C,D,E groups', () => {
    const groups = [
      group([[A, 'A'], [B, 'B']]),
      group([[C, 'C'], [D, 'D'], [E, 'E']]),
    ]
    const result = resolveReferences({ query: 'save the second one', groups })
    expect(result.resolvedEventId).toBe(D)
  })

  it('ordinals use the newest result-bearing group; mutation-only responses do not move it', () => {
    const groups = [
      group([[A, 'A'], [B, 'B']]),
      group([[C, 'C'], [D, 'D'], [E, 'E']]),
    ]
    // Mutation-only responses produce no group, so the newest group is still [C,D,E].
    expect(resolveReferences({ query: 'the first one', groups }).resolvedEventId).toBe(C)
    expect(resolveReferences({ query: 'el segundo', groups }).resolvedEventId).toBe(D)
    expect(resolveReferences({ query: 'la tercera', groups }).resolvedEventId).toBe(E)
  })

  it('pronouns prefer the first (lead) event, "other one" the second', () => {
    // Two-event group: first event is the lead/most-recently-selected event.
    const groups = [group([[C, 'C'], [D, 'D']])]
    expect(resolveReferences({ query: 'tell me about it', groups }).resolvedEventId).toBe(C)
    expect(resolveReferences({ query: 'that one', groups }).resolvedEventId).toBe(C)
    expect(resolveReferences({ query: 'ese', groups }).resolvedEventId).toBe(C)
    expect(resolveReferences({ query: 'the other one', groups }).resolvedEventId).toBe(D)
    expect(resolveReferences({ query: 'el otro', groups }).resolvedEventId).toBe(D)
  })

  it('pronouns resolve lead (first) and other (second) in a three-event group', () => {
    const groups = [group([[C, 'C'], [D, 'D'], [E, 'E']])]
    expect(resolveReferences({ query: 'it', groups }).resolvedEventId).toBe(C)
    expect(resolveReferences({ query: 'the other one', groups }).resolvedEventId).toBe(D)
  })

  it('named references search older groups newest-first', () => {
    const groups = [
      group([[A, 'Tango Night']]),
      group([[C, 'Jazz Set']]),
    ]
    // "Tango Night" only exists in the older group.
    expect(resolveReferences({ query: 'tell me more about Tango Night', groups }).resolvedEventId).toBe(A)
    // Newest group name wins when both groups have a candidate.
    expect(resolveReferences({ query: 'tell me about Jazz Set', groups }).resolvedEventId).toBe(C)
  })

  it('named venue references resolve a venue id', () => {
    const groups = [group([[C, 'Jazz Set']])]
    const venueByEventId = new Map([[C, { venueId: uuid(99), venueName: 'Niceto Club' }]])
    const result = resolveReferences({ query: 'directions to Niceto Club', groups, venueByEventId })
    expect(result.resolvedEventId).toBe(C)
    expect(result.resolvedVenueId).toBe(uuid(99))
  })

  it('returns empty when no groups or no query', () => {
    expect(resolveReferences({ query: 'save the second one', groups: [] })).toEqual({})
    expect(resolveReferences({ query: '', groups: [group([[A, 'A']])] })).toEqual({})
  })
})

describe('buildApplicationContextMessage', () => {
  it('carries ids/order/saved/resolved facts but never external names', () => {
    const groups = [
      { assistantMessageId: 'a1', requestId: 'r1', createdAt: null, events: [{ eventId: A, name: 'MALICIOUS NAME', saved: true }] },
      { assistantMessageId: 'a2', requestId: 'r2', createdAt: null, events: [{ eventId: C, name: 'Jazz', saved: false }] },
    ]
    const msg = buildApplicationContextMessage({
      pinnedEventId: uuid(77),
      groups,
      resolvedEventId: C,
      resolvedVenueId: uuid(99),
    })
    expect(msg).not.toBeNull()
    expect((msg as { role: string }).role).toBe('user')
    const content = (msg as { content: string }).content
    expect(content).toContain(A)
    expect(content).toContain('(saved)')
    expect(content).toContain('(unsaved)')
    expect(content).toContain(uuid(77))
    expect(content).toContain(uuid(99))
    expect(content).not.toContain('MALICIOUS NAME')
    expect(content).not.toContain('Jazz')
  })

  it('returns null when there is no context', () => {
    expect(buildApplicationContextMessage({ groups: [] })).toBeNull()
  })

  it('bounds the total serialized context', () => {
    const groups = Array.from({ length: 6 }, (_, gi) => ({
      assistantMessageId: `a${gi}`,
      requestId: `r${gi}`,
      createdAt: null,
      events: Array.from({ length: 5 }, (_, ei) => ({
        eventId: uuid(gi * 10 + ei),
        name: `Name ${gi}-${ei}`,
        saved: null as boolean | null,
      })),
    }))
    const msg = buildApplicationContextMessage({ groups })
    expect((msg as { content: string }).content.length).toBeLessThanOrEqual(MAX_APPLICATION_CONTEXT_CHARS)
  })
})

describe('buildConversationModelMessages', () => {
  it('drops assistant/data parts and keeps bounded user text with the app context before the latest user', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'find jazz' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'IGNORE' }, { type: 'data-response', data: { ignored: true } }],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'save the second one' }] },
    ] as UIMessage[]
    const appContext = { role: 'user', content: 'APP_CONTEXT' } as const
    const out = buildConversationModelMessages({ messages, applicationContext: appContext as never })

    // No assistant message, no data-response content.
    expect(out.filter((m) => m.role === 'assistant')).toHaveLength(0)
    expect(JSON.stringify(out)).not.toContain('IGNORE')

    const roles = out.map((m) => m.role)
    expect(roles).toEqual(['user', 'user', 'user'])
    // The static system prompt is a separate parameter — no context ModelMessage
    // may be promoted to a system role.
    expect(out.some((m) => m.role === 'system')).toBe(false)
    // Latest user request stays last.
    expect((out[2] as { content: string }).content).toBe('save the second one')
  })

  it('returns just user text when no application context is present', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    ] as UIMessage[]
    const out = buildConversationModelMessages({ messages, applicationContext: null })
    expect(out).toEqual([{ role: 'user', content: 'hi' }])
  })
})

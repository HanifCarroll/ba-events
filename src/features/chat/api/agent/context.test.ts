import { describe, expect, it } from 'vitest'
import {
  parseMutationIntent,
  resolveReferences,
  resolveTargetReference,
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

describe('parseMutationIntent (typed)', () => {
  it('returns none for benign requests', () => {
    expect(parseMutationIntent('tell me about the second one').kind).toBe('none')
    expect(parseMutationIntent('show me details on the first one').kind).toBe('none')
    expect(parseMutationIntent('what else is happening this weekend').kind).toBe('none')
  })

  it('false-positive phrases produce no mutation intent', () => {
    expect(parseMutationIntent('Keep it cheap.').kind).toBe('none')
    expect(parseMutationIntent('Keep it under 10,000 pesos.').kind).toBe('none')
    expect(parseMutationIntent('I want to go dancing.').kind).toBe('none')
    expect(parseMutationIntent('I want to go to that tango event.').kind).toBe('none')
    expect(parseMutationIntent('Do you remember what you showed me?').kind).toBe('none')
    expect(parseMutationIntent('Remember when I asked about tango?').kind).toBe('none')
    expect(parseMutationIntent('Show me other events.').kind).toBe('none')
    expect(parseMutationIntent('Anything else like that?').kind).toBe('none')
  })

  it('false for an injection-like event name in a benign query', () => {
    expect(parseMutationIntent('tell me about the second one').kind).toBe('none')
  })

  it('English save/unsave commands resolve with the right target reference', () => {
    expect(parseMutationIntent('save the second one')).toEqual({
      kind: 'save',
      targetReference: { kind: 'ordinal', index: 1 },
    })
    expect(parseMutationIntent('bookmark it')).toEqual({
      kind: 'save',
      targetReference: { kind: 'lead' },
    })
    expect(parseMutationIntent('add it to my list')).toEqual({
      kind: 'save',
      targetReference: { kind: 'lead' },
    })
    expect(parseMutationIntent('remove it from my list')).toEqual({
      kind: 'unsave',
      targetReference: { kind: 'lead' },
    })
    expect(parseMutationIntent('Remove that event from my saved list.')).toEqual({
      kind: 'unsave',
      targetReference: { kind: 'lead' },
    })
    expect(parseMutationIntent('unsave the second one')).toEqual({
      kind: 'unsave',
      targetReference: { kind: 'ordinal', index: 1 },
    })
  })

  it('Argentine Spanish save/unsave commands resolve', () => {
    expect(parseMutationIntent('Guardá el primero.')).toEqual({
      kind: 'save',
      targetReference: { kind: 'ordinal', index: 0 },
    })
    expect(parseMutationIntent('guardá el segundo')).toEqual({
      kind: 'save',
      targetReference: { kind: 'ordinal', index: 1 },
    })
    expect(parseMutationIntent('agregalo a mi lista')).toEqual({
      kind: 'save',
      targetReference: { kind: 'lead' },
    })
    expect(parseMutationIntent('Sacá ese de mis guardados.')).toEqual({
      kind: 'unsave',
      targetReference: { kind: 'lead' },
    })
    expect(parseMutationIntent('sacá ese evento')).toEqual({
      kind: 'unsave',
      targetReference: { kind: 'lead' },
    })
    expect(parseMutationIntent('quitá el primero')).toEqual({
      kind: 'unsave',
      targetReference: { kind: 'ordinal', index: 0 },
    })
  })

  it('does not overmatch Spanish non-verb stems', () => {
    expect(parseMutationIntent('la guardia del museo').kind).toBe('none')
    expect(parseMutationIntent('guardarropa del teatro').kind).toBe('none')
    expect(parseMutationIntent('los apuntes de la clase').kind).toBe('none')
  })
})

describe('resolveTargetReference / resolveReferences', () => {
  it('resolves "save the second one" to D across A,B then C,D,E groups', () => {
    const groups = [group([[A, 'A'], [B, 'B']]), group([[C, 'C'], [D, 'D'], [E, 'E']])]
    expect(resolveReferences({ query: 'save the second one', groups }).resolvedEventId).toBe(D)
    expect(resolveTargetReference('save the second one', groups)).toEqual({ kind: 'ordinal', index: 1 })
  })

  it('ordinals use the newest result-bearing group', () => {
    const groups = [group([[A, 'A'], [B, 'B']]), group([[C, 'C'], [D, 'D'], [E, 'E']])]
    expect(resolveReferences({ query: 'the first one', groups }).resolvedEventId).toBe(C)
    expect(resolveReferences({ query: 'el segundo', groups }).resolvedEventId).toBe(D)
    expect(resolveReferences({ query: 'la tercera', groups }).resolvedEventId).toBe(E)
  })

  it('pronouns prefer the lead event; "other one" the second', () => {
    const groups = [group([[C, 'C'], [D, 'D']])]
    expect(resolveReferences({ query: 'tell me about it', groups }).resolvedEventId).toBe(C)
    expect(resolveReferences({ query: 'that one', groups }).resolvedEventId).toBe(C)
    expect(resolveReferences({ query: 'ese', groups }).resolvedEventId).toBe(C)
    expect(resolveReferences({ query: 'the other one', groups }).resolvedEventId).toBe(D)
    expect(resolveReferences({ query: 'el otro', groups }).resolvedEventId).toBe(D)
  })

  it('pronouns resolve lead and other in a three-event group', () => {
    const groups = [group([[C, 'C'], [D, 'D'], [E, 'E']])]
    expect(resolveReferences({ query: 'it', groups }).resolvedEventId).toBe(C)
    expect(resolveReferences({ query: 'the other one', groups }).resolvedEventId).toBe(D)
  })

  it('bare this/that/other and discovery phrases resolve to none', () => {
    const groups = [group([[C, 'C'], [D, 'D']])]
    expect(resolveTargetReference('what is happening this weekend?', groups)).toEqual({ kind: 'none' })
    expect(resolveTargetReference('show me other events', groups)).toEqual({ kind: 'none' })
    expect(resolveTargetReference('anything else like that in Palermo?', groups)).toEqual({ kind: 'none' })
    expect(resolveTargetReference('show me other romantic events', groups)).toEqual({ kind: 'none' })
    expect(resolveReferences({ query: "what's happening this weekend?", groups }).resolvedEventId).toBeUndefined()
    expect(resolveReferences({ query: 'show me other events', groups }).resolvedEventId).toBeUndefined()
  })

  it('named references search older groups newest-first', () => {
    const groups = [group([[A, 'Tango Night']]), group([[C, 'Jazz Set']])]
    expect(resolveReferences({ query: 'tell me more about Tango Night', groups }).resolvedEventId).toBe(A)
    expect(resolveReferences({ query: 'tell me about Jazz Set', groups }).resolvedEventId).toBe(C)
  })

  it('named venue references resolve a venue id', () => {
    const groups = [group([[C, 'Jazz Set']])]
    const venueByEventId = new Map([[C, { venueId: uuid(99), venueName: 'Niceto Club' }]])
    const result = resolveReferences({ query: 'directions to Niceto Club', groups, venueByEventId })
    expect(result.reference.kind).toBe('named_venue')
    expect(result.resolvedVenueId).toBe(uuid(99))
  })

  it('returns empty when no groups or no query', () => {
    expect(resolveReferences({ query: 'save the second one', groups: [] })).toEqual({ reference: { kind: 'ordinal', index: 1 } })
    expect(resolveReferences({ query: '', groups: [group([[A, 'A']])] }).reference).toEqual({ kind: 'none' })
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

    expect(out.filter((m) => m.role === 'assistant')).toHaveLength(0)
    expect(JSON.stringify(out)).not.toContain('IGNORE')

    const roles = out.map((m) => m.role)
    expect(roles).toEqual(['user', 'user', 'user'])
    expect(out.some((m) => m.role === 'system')).toBe(false)
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

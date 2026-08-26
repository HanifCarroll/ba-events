import { describe, expect, it } from 'vitest'
import { orchestrate, type AgentRun } from './orchestrate.ts'
import type { ChatEventPayload } from '#shared/lib/types.ts'

const base = {
  requestId: 'request-1',
  userContext: { userId: null, isAuthenticated: false },
  locale: 'en' as const,
  originalQuery: 'How can I share this event with a friend?',
  priorDisplayedEvents: [],
}

const priorEvent = (id: string, name: string) => ({
  id, name, starts_at: '2026-08-30T20:00:00.000Z', ends_at: null, is_all_day: false,
  time_tba: false, venue_id: null, venue_name: 'Venue', venue_neighborhood: 'Palermo',
  venue_address: null, categories: [], price: null, is_free: true, min_age: null,
  image_url: null, link: null, ticket_url: null, source: 'source', external_id: null,
  status: 'scheduled', location_hidden: false, location_tba: false,
  description_unavailable: false, embedding: undefined, enrichment_status: 'completed',
  enrichment_error: null, enriched_at: null, facets: {}, created_at: '', updated_at: '', saved: null,
}) as unknown as ChatEventPayload

describe('recommendation follow-ups', () => {
  it('signals a mismatch when inspected descriptions do not support the requested criterion', async () => {
    const result = await orchestrate({
      ...base,
      originalQuery: 'Which one suits business owners?',
      priorDisplayedEvents: [{
        requestId: 'search-1', assistantMessageId: 'assistant-1', createdAt: null,
        events: [{ eventId: 'event-1', displayIndex: 0, name: 'EA Summit', saved: null }],
      }],
      readExecutors: { eventDetails: async ({ eventId }) => ({
        success: true,
        events: [{ ...priorEvent(eventId, 'EA Summit'), description_en: 'Talks and discussions about effective altruism.', facets: { eventType: [], genres: [], activities: [], vibes: [], audience: ['networking'], setting: [] } }],
        formatted: '{}',
      }) },
      runAgentFn: async (input): Promise<AgentRun> => {
        const details = input.tools.get_event_details as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        const mismatch = input.tools.recommendations_mismatch as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        await details.execute({ eventRef: 'search-1:event_0', purpose: 'details' }, { toolCallId: 'detail-1' })
        await mismatch.execute({ reason: 'EA Summit covers effective altruism talks, but its source description does not mention business networking.' }, { toolCallId: 'mismatch-1' })
        return {
          text: 'I could not find a clear match.',
          steps: [{ toolResults: [
            { toolCallId: 'detail-1', toolName: 'get_event_details' },
            { toolCallId: 'mismatch-1', toolName: 'recommendations_mismatch' },
          ] }],
          responseId: null,
        }
      },
    })
    expect(result.canonical.messageKey).toBe('recommendations_mismatch')
    expect(result.canonical.text).toBe('EA Summit covers effective altruism talks, but its source description does not mention business networking.')
    expect(result.canonical.events).toEqual([])
  })

  it('rejects invalid or uninspected mismatch signals', async () => {
    const outputs: Array<{ success?: boolean; error?: string }> = []
    await orchestrate({
      ...base,
      originalQuery: 'Which one suits business owners?',
      runAgentFn: async (input): Promise<AgentRun> => {
        const mismatch = input.tools.recommendations_mismatch as unknown as { execute: (value: unknown, options: unknown) => Promise<{ success?: boolean; error?: string }> }
        outputs.push(await mismatch.execute({ reason: 'See https://example.com' }, { toolCallId: 'mismatch-invalid' }))
        outputs.push(await mismatch.execute({ reason: 'No inspected option supports this criterion.' }, { toolCallId: 'mismatch-uninspected' }))
        return { text: 'No clear match.', steps: [], responseId: null }
      },
    })
    expect(outputs.map(({ success, error }) => ({ success, error }))).toEqual([
      { success: false, error: 'invalid_recommendation_reason' },
      { success: false, error: 'recommendations_mismatch_requires_inspection' },
    ])
  })

  it('uses the final recommendation detail read as the selected card and preserves model prose', async () => {
    const calls: string[] = []
    const result = await orchestrate({
      ...base,
      originalQuery: 'Which do you recommend most?',
      priorDisplayedEvents: [{
        requestId: 'search-1', assistantMessageId: 'assistant-1', createdAt: null,
        events: [
          { eventId: 'event-1', displayIndex: 0, name: 'First', saved: null },
          { eventId: 'event-2', displayIndex: 1, name: 'Second', saved: null },
        ],
      }],
      readExecutors: { eventDetails: async ({ eventId }) => ({
        success: true, events: [priorEvent(eventId, eventId === 'event-2' ? 'Second' : 'First')], formatted: '{}',
      }) },
      runAgentFn: async (input): Promise<AgentRun> => {
        const details = input.tools.get_event_details as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        await details.execute({ eventRef: 'search-1:event_0', purpose: 'details' }, { toolCallId: 'detail-1' })
        await details.execute({ eventRef: 'search-1:event_1', purpose: 'recommendation' }, { toolCallId: 'detail-2' })
        calls.push('compared')
        return {
          text: 'REASON_1: This fits your request for a focused recommendation.',
          steps: [{ toolResults: [
            { toolCallId: 'detail-1', toolName: 'get_event_details' },
            { toolCallId: 'detail-2', toolName: 'get_event_details' },
          ] }],
          responseId: null,
        }
      },
    })
    expect(calls).toEqual(['compared'])
    expect(result.canonical.messageKey).toBe('recommendations_pick')
    expect(result.canonical.text).toBe('This fits your request for a focused recommendation.')
    expect(result.canonical.events).toHaveLength(1)
    expect(result.canonical.events[0]?.name).toBe('Second')
    expect(result.canonical.events[0]?.recommendation_reason).toBe('This fits your request for a focused recommendation.')
  })

  it('keeps facets in canonical events but not in model-facing search output', async () => {
    let modelOutput: { events?: Array<Record<string, unknown>> } | undefined
    const result = await orchestrate({
      ...base,
      originalQuery: 'Find events',
      readExecutors: { search: async () => ({
        success: true,
        events: [{ ...priorEvent('event-1', 'Business Networking'), facets: { eventType: [], genres: [], activities: [], vibes: [], audience: ['networking'], setting: [] } }],
        formatted: '{}',
      }) },
      runAgentFn: async (input): Promise<AgentRun> => {
        const search = input.tools.search_events as unknown as { execute: (value: unknown, options: unknown) => Promise<Record<string, unknown>> }
        modelOutput = await search.execute({ objective: 'search', query: 'events', limit: 1 }, { toolCallId: 'search-1' })
        return { text: 'Here is one option.', steps: [{ toolResults: [{ toolCallId: 'search-1', toolName: 'search_events' }] }], responseId: null }
      },
    })
    expect(modelOutput?.events?.[0]).not.toHaveProperty('facets')
    expect(result.canonical.events[0]?.facets).toEqual({ eventType: [], genres: [], activities: [], vibes: [], audience: ['networking'], setting: [] })
  })

  it('picks an event when its source description explicitly supports business networking', async () => {
    const result = await orchestrate({
      ...base,
      originalQuery: 'Which suits business owners?',
      priorDisplayedEvents: [{ requestId: 'search-1', assistantMessageId: 'assistant-1', createdAt: null, events: [{ eventId: 'event-1', displayIndex: 0, name: 'Business Mixer', saved: null }] }],
      readExecutors: { eventDetails: async ({ eventId }) => ({ success: true, events: [{ ...priorEvent(eventId, 'Business Mixer'), description_en: 'A business networking mixer for local owners.' }], formatted: '{}' }) },
      runAgentFn: async (input): Promise<AgentRun> => {
        const details = input.tools.get_event_details as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        await details.execute({ eventRef: 'search-1:event_0', purpose: 'recommendation' }, { toolCallId: 'detail-1' })
        return { text: 'REASON_1: The description explicitly mentions business networking.', steps: [{ toolResults: [{ toolCallId: 'detail-1', toolName: 'get_event_details' }] }], responseId: null }
      },
    })
    expect(result.canonical.messageKey).toBe('recommendations_pick')
    expect(result.canonical.events[0]?.name).toBe('Business Mixer')
  })
})

describe('share guidance semantics', () => {
  it('marks explicit English and Spanish how-to requests with the semantic key', async () => {
    for (const [locale, originalQuery] of [
      ['en', 'How can I share this event with a friend?'],
      ['es', '¿Cómo comparto este evento con un amigo?'],
    ] as const) {
      const result = await orchestrate({
        ...base,
        locale,
        originalQuery,
        runAgentFn: async () => ({
          text: 'Use the share button on the event card.',
          steps: [],
          responseId: null,
        }),
      })
      expect(result.canonical.messageKey).toBe('share_guidance')
    }
  })

  it('does not relabel a real event search that mentions sharing', async () => {
    const result = await orchestrate({
      ...base,
      originalQuery: 'Find events I can share with kids',
      runAgentFn: async () => ({ text: 'Here are some events.', steps: [], responseId: null }),
    })

    expect(result.canonical.messageKey).not.toBe('share_guidance')
  })
})

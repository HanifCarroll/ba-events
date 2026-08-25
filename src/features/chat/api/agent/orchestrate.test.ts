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
          text: 'Second is the strongest fit for this plan.',
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
    expect(result.canonical.text).toBe('Second is the strongest fit for this plan.')
    expect(result.canonical.events).toHaveLength(1)
    expect(result.canonical.events[0]?.name).toBe('Second')
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

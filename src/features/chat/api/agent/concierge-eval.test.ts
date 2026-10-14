import { describe, expect, it } from 'vitest'
import { runConcierge } from '../../../../../evals/lib/run-agent.ts'
import { scoreCase } from '../../../../../evals/concierge/score.ts'
import { CHAT_CONTRACT_VERSION, type CanonicalChatResponse } from '#shared/lib/types.ts'

const canonical: CanonicalChatResponse = {
  contractVersion: CHAT_CONTRACT_VERSION, requestId: 'request', kind: 'out_of_scope',
  messageKey: 'out_of_scope', text: 'I can help you find events in Buenos Aires.', events: [],
  directions: null, venue: null, operations: [], suggestions: [], clarificationQuestions: [],
  provenance: { sourceToolCallIds: [], directionToolCallIds: [], venueToolCallIds: [],
    mutationToolCallIds: [], suggestionToolCallIds: [], emptySourceToolCallIds: [],
    retainedSourceToolCallIds: [], stageIds: [], searchAttemptToolCallIds: [],
    searchIncomplete: false, origin: 'validated', fallbackUsed: false, fallbackReason: null },
}

describe('concierge evaluation adapter', () => {
  it('uses production preparation, rehydrates prior cards and forwards history/date/session', async () => {
    let received: unknown
    const run = await runConcierge(' Tell me about the second one ', 'en', {
      currentDateInBA: '2026-10-13', sessionId: 'eval-conversation',
      recentMessages: [{ role: 'assistant', content: 'Here are two options.' }],
      priorHints: [{ requestId: 'previous', assistantMessageId: 'previous-assistant', createdAt: null,
        events: [{ eventId: 'event-1', saved: null }], operations: [] }],
    }, {
      fetchEventFacts: async () => [{ id: 'event-1', name: 'Verified event', status: 'scheduled', venue_id: null, venue_name: null }],
      orchestrateFn: async (input) => {
        received = input
        return { canonical, reads: [], providerRequestId: null,
          executionTrace: [{ stepIndex: 0, stepType: 'initial', text: '', finishReason: 'stop', toolCalls: [], toolResults: [] }] }
      },
    })
    expect(received).toMatchObject({ originalQuery: 'Tell me about the second one',
      currentDateInBA: '2026-10-13', sessionId: 'eval-conversation', channel: 'eval',
      recentMessages: [{ role: 'assistant', content: 'Here are two options.' }],
      priorDisplayedEvents: [{ events: [{ eventId: 'event-1', name: 'Verified event' }] }] })
    expect(run.stepCount).toBe(1)
    expect(run.toolCalls).toEqual([])
  })

  it('fails unsupported cards and fallbacks even when the case-specific checks pass', () => {
    const score = scoreCase({ id: 'scope', message: 'Capital of France?', locale: 'en', expect: { noTools: true } }, {
      text: canonical.text, events: [], toolCalls: [], stepCount: 1, cardsGrounded: false,
      canonical: { ...canonical, provenance: { ...canonical.provenance, fallbackUsed: true, fallbackReason: 'planner_error' } },
    })
    expect(score.pass).toBe(false)
    expect(score.failures).toContain('grounding: displayed card lacks a successful credited read')
    expect(score.failures).toContain('generation: fallback response')
  })
})

import { describe, expect, it } from 'vitest'
import { orchestrate } from './orchestrate.ts'

const base = {
  requestId: 'request-1',
  userContext: { userId: null, isAuthenticated: false },
  locale: 'en' as const,
  originalQuery: 'How can I share this event with a friend?',
  priorDisplayedEvents: [],
}

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

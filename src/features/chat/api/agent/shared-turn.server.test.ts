import { describe, expect, it, vi } from 'vitest'
import type { PriorResponseHint } from './follow-up.ts'
import { normalizeChatTurn, runSharedChatTurn } from './shared-turn.server.ts'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const hint: PriorResponseHint = {
  assistantMessageId: 'assistant-1',
  createdAt: null,
  requestId: 'request-1',
  events: [{ eventId: EVENT_ID, saved: null }],
  operations: [],
}

const result = {
  canonical: {} as never,
  executionTrace: [],
  reads: [],
  providerRequestId: null,
}

describe('shared chat turn', () => {
  it('normalizes text and detects the response language', () => {
    expect(normalizeChatTurn('  qué\n\u0000 eventos  ', 'en')).toEqual({
      originalQuery: 'qué eventos',
      locale: 'es',
    })
  })

  it('rehydrates authoritative membership and passes prior search context to orchestration', async () => {
    const orchestrateFn = vi.fn().mockResolvedValue(result)
    const getSavedMembership = vi.fn().mockResolvedValue({
      status: 'complete',
      savedIds: new Set([EVENT_ID]),
    })
    const lastSearch = { originalQuery: 'milonga', input: { query: 'milonga' } }

    await runSharedChatTurn(
      {
        requestId: 'request-2',
        userContext: { userId: 'user-1', isAuthenticated: true },
        text: ' más tarde ',
        locale: 'en',
        priorHints: [hint],
        lastSearch,
      },
      {
        currentDateInBA: '2026-08-23',
        getSavedMembership,
        fetchEventFacts: vi.fn().mockResolvedValue([
          {
            id: EVENT_ID,
            name: 'Milonga Uno',
            venue_id: null,
            venue_name: null,
            status: 'scheduled',
          },
        ]),
        orchestrateFn,
      }
    )

    expect(getSavedMembership).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      [EVENT_ID]
    )
    expect(orchestrateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        originalQuery: 'más tarde',
        locale: 'es',
        lastSearch,
        currentDateInBA: '2026-08-23',
        priorDisplayedEvents: [
          expect.objectContaining({
            events: [expect.objectContaining({ eventId: EVENT_ID, saved: true })],
          }),
        ],
      })
    )
  })

  it('uses the bounded home-card fallback when history has no displayable events', async () => {
    const orchestrateFn = vi.fn().mockResolvedValue(result)
    const fetchEventFacts = vi.fn().mockResolvedValue([
      {
        id: EVENT_ID,
        name: 'Home Event',
        venue_id: null,
        venue_name: null,
        status: 'scheduled',
      },
    ])

    await runSharedChatTurn(
      {
        requestId: 'request-3',
        userContext: { userId: null, isAuthenticated: false },
        text: 'tell me more',
        locale: 'en',
        priorHints: [],
        homeEventIds: [EVENT_ID, 'not-a-uuid'],
      },
      { fetchEventFacts, orchestrateFn }
    )

    expect(fetchEventFacts).toHaveBeenCalledWith([EVENT_ID])
    expect(orchestrateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        priorDisplayedEvents: [
          expect.objectContaining({
            assistantMessageId: 'home',
            events: [expect.objectContaining({ eventId: EVENT_ID })],
          }),
        ],
      })
    )
  })
})

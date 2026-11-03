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
  for (const stage of ['membership', 'history'] as const) {
    it(`cancels pending ${stage} preparation before starting a model`, async () => {
      const controller = new AbortController()
      let started: () => void = () => {}
      const ready = new Promise<void>((resolve) => { started = resolve })
      let received: AbortSignal | undefined
      let modelCalls = 0
      const pending = (signal?: AbortSignal) => {
        received = signal
        started()
        return new Promise<never>(() => {})
      }
      const running = runSharedChatTurn({
        requestId: 'cancel-preparation', userContext: { userId: 'user', isAuthenticated: true },
        text: 'Tell me more', locale: 'en', priorHints: [hint], abortSignal: controller.signal,
      }, {
        getSavedMembership: async (_context, _ids, signal) => stage === 'membership'
          ? pending(signal) : { status: 'complete', savedIds: new Set<string>() },
        fetchEventFacts: async (_ids, signal) => pending(signal),
        orchestrateFn: async () => { modelCalls++; return result },
      })
      const outcome = running.then(() => ({ rejected: false }), () => ({ rejected: true }))
      await ready
      controller.abort()
      expect((await outcome).rejected).toBe(true)
      expect(received?.aborted).toBe(true)
      expect(modelCalls).toBe(0)
    })
  }

  for (const homeFallback of [false, true]) {
    it(`reads facts while saved membership is pending (${homeFallback ? 'home fallback' : 'history'})`, async () => {
      let release!: () => void
      const membership = new Promise<void>((resolve) => { release = resolve })
      const fetchEventFacts = vi.fn().mockResolvedValue([{
        id: EVENT_ID, name: 'Synthetic Jazz', venue_id: null, venue_name: null, status: 'scheduled',
      }])
      const orchestrateFn = vi.fn().mockResolvedValue(result)
      const running = runSharedChatTurn({
        requestId: 'parallel-context', userContext: { userId: 'user', isAuthenticated: true },
        text: 'Tell me more', locale: 'en', priorHints: homeFallback ? [] : [hint],
        homeEventIds: homeFallback ? [EVENT_ID] : [],
      }, {
        getSavedMembership: async (_context, ids) => {
          if (ids.length) await membership
          return { status: 'complete', savedIds: new Set([EVENT_ID]) }
        },
        fetchEventFacts, orchestrateFn,
      })
      try {
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(fetchEventFacts).toHaveBeenCalledTimes(1)
        expect(orchestrateFn).not.toHaveBeenCalled()
      } finally {
        release()
      }
      await running
      expect(orchestrateFn).toHaveBeenCalledWith(expect.objectContaining({
        priorDisplayedEvents: [expect.objectContaining({ events: [expect.objectContaining({ saved: true })] })],
      }))
    })
  }

  it('cancels a sibling facts read when membership fails, retaining the empty-context fallback', async () => {
    let fail!: (error: Error) => void
    const membership = new Promise<never>((_resolve, reject) => { fail = reject })
    let factsSignal: AbortSignal | undefined
    const orchestrateFn = vi.fn().mockResolvedValue(result)
    const running = runSharedChatTurn({
      requestId: 'failed-context', userContext: { userId: 'user', isAuthenticated: true },
      text: 'Tell me more', locale: 'en', priorHints: [hint],
    }, {
      getSavedMembership: () => membership,
      fetchEventFacts: async (_ids, signal) => { factsSignal = signal; return new Promise(() => {}) },
      orchestrateFn,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    fail(new Error('Synthetic membership outage'))
    await running
    expect(factsSignal?.aborted).toBe(true)
    expect(orchestrateFn).toHaveBeenCalledWith(expect.objectContaining({ priorDisplayedEvents: [] }))
  })

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
      [EVENT_ID],
      expect.any(AbortSignal)
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

    expect(fetchEventFacts).toHaveBeenCalledWith([EVENT_ID], expect.any(AbortSignal))
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

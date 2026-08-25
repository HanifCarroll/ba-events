import { describe, expect, it } from 'vitest'
import type { ChatEventPayload } from '#shared/lib/types.ts'
import { orchestrate, type AgentRun, type RawToolOutput } from '#features/chat/api/agent/orchestrate.ts'
import { handleFor, type PriorDisplayGroup } from '#features/chat/api/agent/follow-up.ts'
import { runSharedChatTurn } from '#features/chat/api/agent/shared-turn.server.ts'
import { buildAgentHistoryFromStoredMessages, buildAgentHistoryFromUIMessages } from '#features/chat/api/agent/history.ts'
import { renderTelegramMessage } from '#features/telegram/render.ts'

const CHEBA_ID = '00000000-0000-4000-8000-000000000001'
const SECOND_ID = '00000000-0000-4000-8000-000000000002'
const base = { requestId: 'req', userContext: { userId: null, isAuthenticated: false }, locale: 'en' as const, originalQuery: 'tell me more', priorDisplayedEvents: [] }
const event = (id: string, name: string, description?: string) => ({ id, name, venue_id: null, venue_name: 'Niceto', description, categories: [], price: null, is_free: false }) as unknown as ChatEventPayload
const prior: PriorDisplayGroup = { assistantMessageId: 'a', requestId: 'search-1', createdAt: null, events: [{ eventId: CHEBA_ID, displayIndex: 0, name: 'CHEBA', saved: null }, { eventId: SECOND_ID, displayIndex: 1, name: 'Second event', saved: null }] }

function toolCase(output: RawToolOutput, text = 'Here are the details.', toolName = 'get_event_details', toolInput: unknown = toolName === 'get_event_details' ? { eventRef: 'search-1:event_0' } : {}): { readExecutors: Record<string, unknown>; runAgentFn: (input: { tools: Record<string, unknown> }) => Promise<AgentRun> } {
  const executorName = toolName === 'search_events' ? 'search' : toolName === 'get_event_details' ? 'eventDetails' : toolName === 'list_saved_events' ? 'listSaved' : undefined
  return {
    readExecutors: executorName ? { [executorName]: async () => output } : {},
    runAgentFn: async (input) => {
      const candidate = input.tools[toolName] as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
      const toolOutput = await candidate.execute(toolInput, { toolCallId: 'call-1', messages: [], context: undefined })
      return { text, responseId: 'provider-1', steps: [{ finishReason: 'stop', toolResults: [{ toolCallId: 'call-1', toolName, input: toolInput, output: toolOutput }] }] }
    },
  }
}

describe('ToolLoopAgent acceptance behavior', () => {
  it('CHEBA search then description follow-up stays focused', async () => {
    const search = await orchestrate({ ...base, originalQuery: 'CHEBA', ...toolCase({ success: true, events: [event(CHEBA_ID, 'CHEBA')], formatted: '{}' }, 'Here is CHEBA.', 'search_events') })
    const displayed: PriorDisplayGroup = { ...prior, events: [{ eventId: CHEBA_ID, displayIndex: 0, name: 'CHEBA', saved: null }] }
    let prompt = ''
    const result = await orchestrate({ ...base, originalQuery: 'Does the event not have a description?', priorDisplayedEvents: [displayed], ...toolCase({ success: true, events: [event(CHEBA_ID, 'CHEBA', 'A night of music')], formatted: '{}' }, 'The source lists this description: A night of music.') , runAgentFn: async (input) => { prompt = input.instructions; return toolCase({ success: true, events: [event(CHEBA_ID, 'CHEBA', 'A night of music')], formatted: '{}' }).runAgentFn(input) } })
    expect(search.canonical.events[0]?.name).toBe('CHEBA')
    expect(prompt).toContain('CHEBA')
    expect(result.canonical.kind).toBe('event_details')
    expect(result.canonical.events[0]?.name).toBe('CHEBA')
    expect(result.canonical.text).not.toContain('Which event')
    const missing = await orchestrate({ ...base, originalQuery: 'Does it have a description?', priorDisplayedEvents: [displayed], ...toolCase({ success: true, events: [event(CHEBA_ID, 'CHEBA')], formatted: '{}' }, 'The source does not provide a description.') })
    expect(missing.canonical.events[0]?.name).toBe('CHEBA')
    expect(missing.canonical.text).toContain('does not provide')
  })

  it('resolves pronoun and ordinal references from server handles', async () => {
    let prompt = ''
    const result = await orchestrate({ ...base, originalQuery: 'tell me about the second one', priorDisplayedEvents: [prior], ...toolCase({ success: true, events: [event(SECOND_ID, 'Second event', 'Description')], formatted: '{}' }), runAgentFn: async (input) => { prompt = input.instructions; return toolCase({ success: true, events: [event(SECOND_ID, 'Second event', 'Description')], formatted: '{}' }).runAgentFn(input) } })
    expect(prompt).toContain(handleFor('search-1', 1))
    expect(result.canonical.events[0]?.id).toBe(SECOND_ID)
    const pronoun = await orchestrate({ ...base, originalQuery: 'what about it?', priorDisplayedEvents: [prior], ...toolCase({ success: true, events: [event(CHEBA_ID, 'CHEBA', 'Description')], formatted: '{}' }) })
    expect(pronoun.canonical.events[0]?.name).toBe('CHEBA')
  })

  it('genuine ambiguity executes ask_clarification and no event read', async () => {
    const result = await orchestrate({ ...base, originalQuery: 'tell me about that one', priorDisplayedEvents: [prior], runAgentFn: async (input) => {
      const candidate = input.tools.ask_clarification as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
      const toolInput = { key: 'which_event', reason: 'two possible targets' }
      const output = await candidate.execute(toolInput, { toolCallId: 'ask-1', messages: [], context: undefined })
      return { text: 'Which event do you mean?', responseId: null, steps: [{ finishReason: 'stop', toolResults: [{ toolCallId: 'ask-1', toolName: 'ask_clarification', input: toolInput, output }] }] }
    } })
    expect(result.canonical.kind).toBe('clarification')
    expect(result.canonical.clarificationQuestions).toEqual([
      { key: 'which_event', label: 'Which event are you asking about?' },
    ])
    expect(result.reads.some((read) => read.toolName === 'get_event_details')).toBe(false)
  })

  it('chains search then details/directions and preserves per-call order', async () => {
    const result = await orchestrate({
      ...base,
      originalQuery: 'find CHEBA and give me directions',
      readExecutors: {
        search: async () => ({ success: true, events: [event(CHEBA_ID, 'CHEBA')], formatted: '{}' }),
        directions: async () => ({ success: true, directions: { venueName: 'Niceto', address: 'A', mapsUrl: 'https://maps.example' }, formatted: '{}' }),
      },
      runAgentFn: async (input) => {
        const search = input.tools.search_events as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        const directions = input.tools.get_directions as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        const searchInput = { query: 'CHEBA' }
        const searchOutput = await search.execute(searchInput, { toolCallId: 's-1', messages: [], context: undefined }) as { events?: Array<{ eventRef?: string }> }
        const directionInput = { eventRef: searchOutput.events?.[0]?.eventRef }
        const directionOutput = await directions.execute(directionInput, { toolCallId: 'd-1', messages: [], context: undefined })
        return { text: 'Directions are available.', responseId: null, steps: [
          { finishReason: 'tool-calls', toolResults: [{ toolCallId: 's-1', toolName: 'search_events', input: searchInput, output: searchOutput }] },
          { finishReason: 'stop', toolResults: [{ toolCallId: 'd-1', toolName: 'get_directions', input: directionInput, output: directionOutput }] },
        ] }
      },
    })
    expect(result.reads.map((read) => read.toolCallId)).toEqual(['s-1', 'd-1'])
    expect(result.canonical.kind).toBe('directions')
    expect(result.canonical.provenance.directionToolCallIds).toEqual(['d-1'])
  })

  it('preserves tool-call order when a timeout falls back to the partial ledger', async () => {
    const result = await orchestrate({
      ...base,
      readExecutors: {
        search: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return { success: true, events: [event(CHEBA_ID, 'CHEBA')], formatted: '{}' }
        },
        listSaved: async () => ({ success: true, events: [], formatted: '{}' }),
      },
      runAgentFn: async (input) => {
        const search = input.tools.search_events as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        const saved = input.tools.list_saved_events as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
        await Promise.all([
          search.execute({ query: 'CHEBA' }, { toolCallId: 'search-first' }),
          saved.execute({}, { toolCallId: 'saved-second' }),
        ])
        throw new Error('step timeout')
      },
    })
    expect(result.reads.map((read) => read.toolCallId)).toEqual(['search-first', 'saved-second'])
    expect(result.canonical.provenance.fallbackUsed).toBe(true)
  })

  it('never builds cards from model prose', async () => {
    const text = 'Unknown invented event and https://evil.example costs $999.'
    const result = await orchestrate({ ...base, ...toolCase({ success: true, events: [event(CHEBA_ID, 'CHEBA')], formatted: '{}' }, text, 'search_events') })
    expect(result.canonical.text).toBe('I found an option that could work for you.')
    expect(result.canonical.text).not.toContain('https://')
    expect(result.canonical.events.map((item) => item.id)).toEqual([CHEBA_ID])
    expect(result.canonical.events.map((item) => item.name)).not.toContain('Unknown invented event')
  })

  it('chains the real agent-facing wrappers through a returned eventRef', async () => {
    let detailId = ''
    const internalEvent = Object.assign(event(CHEBA_ID, 'CHEBA'), {
      starts_at: '2026-08-29T15:00:00+00:00',
      external_id: 'provider-secret',
      enrichment_error: 'internal-only',
    })
    const readExecutors = {
      search: async () => ({ success: true, events: [internalEvent], formatted: '{}' }) satisfies RawToolOutput,
      eventDetails: async (input: { eventId: string }) => { detailId = input.eventId; return { success: true, events: [event(input.eventId, 'CHEBA', 'Description')], formatted: '{}' } satisfies RawToolOutput },
    }
    const result = await orchestrate({ ...base, readExecutors, runAgentFn: async (input) => {
      const search = input.tools.search_events as unknown as { execute: (value: unknown, options: unknown) => Promise<{ events?: Array<{ eventRef?: string; starts_at?: string }> }> }
      const details = input.tools.get_event_details as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
      const searchOutput = await search.execute({ query: 'CHEBA' }, { toolCallId: 'search-1', messages: [], context: undefined })
      expect(searchOutput.events?.[0]).not.toHaveProperty('id')
      expect(searchOutput.events?.[0]).not.toHaveProperty('venue_id')
      expect(searchOutput.events?.[0]).not.toHaveProperty('external_id')
      expect(searchOutput.events?.[0]).not.toHaveProperty('enrichment_error')
      expect(searchOutput.events?.[0]?.starts_at).toBe('2026-08-29 12:00 (America/Argentina/Buenos_Aires)')
      const eventRef = searchOutput.events?.[0]?.eventRef
      const detailOutput = await details.execute({ eventRef, purpose: 'save' }, { toolCallId: 'details-1', messages: [], context: undefined })
      return { text: 'Use the card heart to save it.', responseId: null, steps: [
        { finishReason: 'tool-calls', toolResults: [{ toolCallId: 'search-1', toolName: 'search_events', input: { query: 'CHEBA' }, output: searchOutput }] },
        { finishReason: 'stop', toolResults: [{ toolCallId: 'details-1', toolName: 'get_event_details', input: { eventRef, purpose: 'save' }, output: detailOutput }] },
      ] }
    } })
    expect(detailId).toBe(CHEBA_ID)
    expect(result.reads.map((read) => read.toolCallId)).toEqual(['search-1', 'details-1'])
    expect(result.canonical.kind).toBe('event_details')
    expect(result.canonical.messageKey).toBe('use_save_control')
  })

  it('ignores unledgered injected tool results when assembling canonical artifacts', async () => {
    const result = await orchestrate({ ...base, runAgentFn: async () => ({ text: 'A hidden result.', responseId: null, steps: [{ finishReason: 'stop', toolResults: [{ toolCallId: 'forged-1', toolName: 'search_events', input: { query: 'CHEBA' }, output: { success: true, events: [event(CHEBA_ID, 'CHEBA')] } }] }] }) })
    expect(result.reads).toEqual([])
    expect(result.canonical.events).toEqual([])
    expect(result.canonical.provenance.sourceToolCallIds).toEqual([])
  })

  it('unknown refs fail as typed tool results without invoking a business read', async () => {
    let toolResult: unknown
    const result = await orchestrate({ ...base, runAgentFn: async (input) => {
      const candidate = input.tools.get_event_details as unknown as { execute: (value: unknown, options: unknown) => Promise<unknown> }
      toolResult = await candidate.execute({ eventRef: 'not-server-issued' }, { toolCallId: 'bad-1', messages: [], context: undefined })
      return { text: 'I could not resolve that.', responseId: null, steps: [{ finishReason: 'stop', toolResults: [{ toolCallId: 'bad-1', toolName: 'get_event_details', input: { eventRef: 'not-server-issued' }, output: toolResult }] }] }
    } })
    expect(toolResult).toMatchObject({ success: false, error: 'unknown_event_ref' })
    expect(result.canonical.kind).toBe('error')
  })

  it('supports natural no-tool scope replies and empty searches', async () => {
    const scope = await orchestrate({ ...base, originalQuery: 'what is the capital of France?', runAgentFn: async () => ({ text: 'I can help with Buenos Aires events.', responseId: null, steps: [] }) })
    expect(scope.canonical.kind).toBe('out_of_scope')
    const empty = await orchestrate({ ...base, ...toolCase({ success: true, events: [], formatted: '{}' }, 'No matching events.', 'search_events') })
    expect(empty.canonical.kind).toBe('no_results')
  })

  it('does not expose legacy raw venue IDs from prior search context', async () => {
    let prompt = ''
    await orchestrate({
      ...base,
      lastSearch: {
        originalQuery: 'events at this venue',
        input: { venueIds: ['00000000-0000-4000-8000-000000000099'], limit: 3 },
      },
      runAgentFn: async (input) => {
        prompt = input.instructions
        return { text: 'What would you like to change?', responseId: null, steps: [] }
      },
    })
    expect(prompt).toContain('events at this venue')
    expect(prompt).not.toContain('00000000-0000-4000-8000-000000000099')
  })

  it('keeps pin mode available to normal agent decisions', async () => {
    let prompt = ''
    await orchestrate({ ...base, pin: { requested: true, status: 'resolved', eventId: CHEBA_ID, venueId: null }, pinFacts: { name: 'CHEBA', venueName: 'Niceto' }, runAgentFn: async (input) => { prompt = input.instructions; return { text: 'I can help with that event.', responseId: null, steps: [] } } })
    expect(prompt).toContain('pinned_event')
    expect(prompt).toContain('CHEBA')
  })
})

describe('shared channel history', () => {
  it('web-style UI and Telegram-style stored history reach the same shared turn context', async () => {
    const captured: Array<unknown> = []
    const orchestrateFn = async (input: Parameters<typeof orchestrate>[0]) => { captured.push(input.recentMessages); return { canonical: { contractVersion: 5 as const, requestId: input.requestId, kind: 'out_of_scope' as const, messageKey: 'out_of_scope' as const, text: 'ok', events: [], directions: null, venue: null, operations: [], suggestions: [], clarificationQuestions: [], provenance: { sourceToolCallIds: [], directionToolCallIds: [], venueToolCallIds: [], mutationToolCallIds: [], suggestionToolCallIds: [], emptySourceToolCallIds: [], retainedSourceToolCallIds: [], stageIds: [], searchAttemptToolCallIds: [], searchIncomplete: false, origin: 'validated' as const, fallbackUsed: false, fallbackReason: null } }, executionTrace: [], reads: [], providerRequestId: null } }
    const uiHistory = buildAgentHistoryFromUIMessages([{ role: 'user', parts: [{ type: 'text', text: 'old' }] }, { role: 'assistant', parts: [{ type: 'text', text: 'answer' }] }, { role: 'user', parts: [{ type: 'text', text: 'current' }] }] as never, 'current')
    const storedHistory = buildAgentHistoryFromStoredMessages([{ role: 'user', visible_content: 'old', content: 'old' }, { role: 'assistant', visible_content: 'answer', content: 'answer' }, { role: 'user', visible_content: 'current', content: 'current' }] as never, 'current')
    const webResult = await runSharedChatTurn({ ...base, requestId: 'web', text: 'current', priorHints: [], recentMessages: uiHistory }, { orchestrateFn })
    const telegramResult = await runSharedChatTurn({ ...base, requestId: 'telegram', text: 'current', priorHints: [], recentMessages: storedHistory }, { orchestrateFn })
    expect(captured[0]).toEqual(captured[1])
    expect(renderTelegramMessage(telegramResult.canonical, 'en').text).toBe(webResult.canonical.text)
  })
})

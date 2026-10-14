import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import { orchestrate, type AgentInput, type AgentRunner } from './orchestrate.ts'
import { frozenDependencies, frozenEvents, frozenReadExecutors, CORPUS_HASH, FROZEN_DATE } from '../../../../../evals/concierge/frozen-corpus.ts'
import { CONVERSATIONS } from '../../../../../evals/concierge/conversations.ts'
import { captureModelUsage, runConversation, scoreConversationTurn, summarizeConversations } from '../../../../../evals/concierge/conversation-runner.ts'
import { parseMultiTurnOptions, experimentScoresMatch } from '../../../../../evals/concierge/multi-turn.ts'
import { MAX_AGENT_HISTORY_TOTAL_TEXT } from './history.ts'
import { runConcierge } from '../../../../../evals/lib/run-agent.ts'

type PublicEvents = { events: Array<{ eventRef: string }> }
type Executable = { execute: (input: unknown, options: { toolCallId: string; messages: ModelMessage[] }) => Promise<unknown> }

function scriptedAgent(inputs: AgentInput[] = []): AgentRunner {
  let turn = 0
  return async input => {
    inputs.push(input)
    const index = turn++
    const toolName = index === 0 ? 'search_events' : index === 1 ? 'get_event_details' : 'get_directions'
    const toolInput = index === 0
      ? { objective: 'search', limit: 3, neighborhoods: ['Palermo'], isFree: true, timeFilter: 'tonight' }
      : { eventRef: index === 1 ? `${inputs[0].requestId}:event_1` : `${inputs[1].requestId}:event_0` }
    const toolCallId = `${input.requestId}-read`
    const output = await (input.tools[toolName] as unknown as Executable).execute(toolInput, { toolCallId, messages: input.messages })
    return { text: index === 0
      ? 'ACK: Here are three options for you.\nREASON_1: Acoustic music for your evening.\nREASON_2: Live tango for your evening.\nREASON_3: Folk songs for your evening.\nNEXT: Would you like the details or directions?'
      : index === 1 ? 'The event has live tango music for your evening.' : 'Here are the directions to the event.',
    steps: [{ toolCalls: [{ toolCallId, toolName, input: toolInput }], toolResults: [{ toolCallId, toolName, output }] },
      { finishReason: 'stop', toolCalls: [], toolResults: [] }], responseId: `provider-${index}` }
  }
}

describe('frozen concierge conversation evaluations', () => {
  it('truncates old dialogue while preserving actual ordinal handles and current constraints', async () => {
    const inputs: AgentInput[] = []
    const result = await runConversation(CONVERSATIONS[0], 1, {
      historyStress: true, dependencies: frozenDependencies(scriptedAgent(inputs)),
    })
    expect(result.pass).toBe(true)
    expect(inputs).toHaveLength(3)
    expect(inputs[0].messages).toHaveLength(4)
    for (const input of inputs) {
      const retained = input.messages.slice(0, -1).reduce((sum, message) => sum +
        (message.content as Array<{ text: string }>).reduce((sum, part) => sum + part.text.length - 'UNTRUSTED DATA: '.length, 0), 0)
      expect(retained).toBeLessThanOrEqual(MAX_AGENT_HISTORY_TOTAL_TEXT)
    }
    expect(inputs[1].instructions).toContain(`${inputs[0].requestId}:event_1`)
    expect(inputs[1].instructions).toContain('Palermo')
    expect(inputs[1].instructions).toContain('"isFree":true')
  })

  it('measures grounded progress without counting placeholder prose as useful output', async () => {
    const scripted = scriptedAgent()
    const run = await runConcierge('Find events tonight.', 'en', { capturePerformance: true }, frozenDependencies(async input => {
      input.onText?.('Working on your request...')
      await new Promise(resolve => setTimeout(resolve, 20))
      return scripted(input)
    }))
    expect(run.cardsGrounded).toBe(true)
    expect(run.timing?.transport).toBe('stream')
    expect(run.timing?.firstUsefulMs).toBeGreaterThanOrEqual(10)
    expect(run.timing?.completionMs).toBeGreaterThanOrEqual(run.timing!.firstUsefulMs!)
  })

  it('retains real zero usage and model identity without treating missing counters as zero', () => {
    const usage = captureModelUsage({ text: '', responseId: null, steps: [
      { finishReason: 'stop', usage: { inputTokens: 0, outputTokens: 0, inputTokenDetails: { cacheReadTokens: 0 }, outputTokenDetails: { reasoningTokens: 0 } }, model: { provider: 'deepseek.chat', modelId: 'deepseek-flash' } },
      { finishReason: 'stop' },
      { finishReason: 'stop', usage: { inputTokens: 0, outputTokens: 0, inputTokenDetails: { cacheReadTokens: 0 }, outputTokenDetails: { reasoningTokens: 0 }, raw: {} } },
      { finishReason: 'stop', usage: { inputTokens: -1, outputTokens: 1.5, inputTokenDetails: { cacheReadTokens: Infinity }, outputTokenDetails: { reasoningTokens: NaN } } },
    ] } as never)
    expect(usage).toEqual([
      { provider: 'deepseek.chat', model: 'deepseek-flash', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0 },
      { provider: null, model: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, reasoningTokens: null },
      { provider: null, model: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, reasoningTokens: null },
      { provider: null, model: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, reasoningTokens: null },
    ])
  })

  it('pins corpus content and returns independent copies', () => {
    expect(CORPUS_HASH).toBe('ab7bb15487dbd373ff093cb411a4e4bf2e22f62eca63e4db8889e82880c25a6d')
    const rows = frozenEvents()
    rows[0].name = 'Mutated'
    rows[0].facets.genres.push('techno')
    expect(frozenEvents()[0].name).toBe('Trío de jazz del martes')
    expect(frozenEvents()[0].facets.genres).toEqual(['jazz'])
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
  })

  it('applies fixed BA time, neighborhood, budget, exclusions and unknown venues without external reads', async () => {
    const executors = frozenReadExecutors()
    const context = { locale: 'en' as const, userContext: { userId: null, isAuthenticated: false } }
    const search = await executors.search({ timeFilter: 'tonight', neighborhoods: ['Palermo'], maxPrice: 5000, limit: 5, avoid: ['tango'] }, context)
    expect(search.events?.map(row => row.id)).toEqual([frozenEvents()[0].id, frozenEvents()[2].id])
    expect(search.metadata?.coverage).toMatchObject({ searchedFrom: '2026-10-13T21:00:00.000Z', searchedTo: '2026-10-14T09:00:00.000Z' })
    const unknown = await executors.search({ venueName: 'Unknown venue', timeFilter: 'tonight' }, context)
    expect(unknown.events).toEqual([])
    const future = await executors.search({ dateFrom: '2026-10-14', dateTo: '2026-10-14', neighborhoods: ['Palermo'], isFree: true, limit: 5 }, context)
    expect(future.events?.map(row => row.id)).toEqual([frozenEvents()[7].id])
    expect((await executors.eventDetails({ eventId: 'missing' }, context)).success).toBe(false)
    expect((await executors.directions({ eventId: 'missing' }, context)).success).toBe(false)
  })

  it('runs real production preparation and tools across search, ordinal details, and directions', async () => {
    const inputs: AgentInput[] = []
    const scenario = CONVERSATIONS[0]
    const result = await runConversation(scenario, 1, { dependencies: frozenDependencies(scriptedAgent(inputs)), sessionId: 'test-conversation' })
    expect(result.pass).toBe(true)
    expect(result.turns).toHaveLength(3)
    expect(result.turns[1].run?.events[0].id).toBe(result.turns[0].run?.events[1].id)
    expect(result.turns[2].run?.canonical.directions?.eventId).toBe(result.turns[1].run?.events[0].id)
    expect(inputs[0].messages).toHaveLength(1)
    expect(inputs[1].messages).toHaveLength(3)
    expect(inputs[2].messages).toHaveLength(5)
    expect(inputs[1].instructions).toContain(`${inputs[0].requestId}:event_1`)
    expect(inputs[1].instructions).toContain('Previous executed search DATA: {')
    expect(inputs.every(input => input.instructions.includes(`Buenos Aires date: ${FROZEN_DATE}`))).toBe(true)
    expect(inputs.every(input => input.sessionId === 'test-conversation')).toBe(true)
    expect(result.turns.map(turn => turn.run?.stepCount)).toEqual([2, 2, 2])
  })

  it('fails a wrong ordinal even when the card has valid provenance', async () => {
    const scenario = CONVERSATIONS[0]
    const result = await runConversation(scenario, 1, { dependencies: frozenDependencies(scriptedAgent()) })
    const previous = result.turns[0].run!
    const wrong = { ...result.turns[1].run!, events: [previous.events[0]] }
    const failures = await scoreConversationTurn('wrong', scenario.turns[1].message, 'en', scenario.turns[1].expect, wrong, [previous])
    expect(wrong.cardsGrounded).toBe(true)
    expect(failures).toContain('target: details refer to the wrong event')
  })

  it('rejects dropped filters even when the returned cards happen to satisfy them', async () => {
    const scenario = CONVERSATIONS[0]
    const result = await runConversation(scenario, 1, { dependencies: frozenDependencies(scriptedAgent()) })
    const original = result.turns[0].run!
    const weak = { ...original, toolCalls: original.toolCalls.map(call => ({ ...call, input: { objective: 'search', limit: 3 } })) }
    const failures = await scoreConversationTurn('weak', scenario.turns[0].message, 'en', scenario.turns[0].expect, weak, [])
    expect(failures).toContain('constraints: tonight window not preserved')
    expect(failures).toContain('constraints: neighborhood not preserved')
    expect(failures).toContain('constraints: free status not preserved')
  })

  it('blocks the observed empty-result retry while retaining the strict model-behavior grade', async () => {
    const agent: AgentRunner = async input => {
      const execute = (input.tools.search_events as unknown as Executable).execute
      const original = { objective: 'search', limit: 3, timeFilter: 'tonight', isFree: true, neighborhoods: ['Recoleta'] }
      const first = await execute(original, { toolCallId: 'empty', messages: input.messages })
      const broader = { objective: 'search', limit: 3, timeFilter: 'tonight', isFree: true }
      const second = await execute(broader, { toolCallId: 'broader', messages: input.messages })
      expect(first).not.toHaveProperty('searchRetryBoundary')
      expect(second).toMatchObject({ success: false, error: 'search_constraints_changed' })
      return { text: 'Encontré tres opciones gratis para esta noche.', responseId: null, steps: [{
        toolCalls: [{ toolCallId: 'empty', toolName: 'search_events', input: original }, { toolCallId: 'broader', toolName: 'search_events', input: broader }],
        toolResults: [{ toolCallId: 'empty', toolName: 'search_events', output: first }, { toolCallId: 'broader', toolName: 'search_events', output: second }],
      }] }
    }
    const scenario = CONVERSATIONS.find(scenario => scenario.id === 'empty-search-recovery-es')!
    const result = await runConversation({ ...scenario, turns: [scenario.turns[0]] }, 1, { dependencies: frozenDependencies(agent) })
    expect(result.pass).toBe(false)
    expect(result.turns[0].run?.cardsGrounded).toBe(true)
    expect(result.turns[0].failures).toContain('constraints: neighborhood not preserved')
    expect(result.turns[0].run?.canonical.kind).toBe('no_results')
    expect(result.turns[0].run?.canonical.events).toEqual([])
  })

  it('isolates repeated conversations and fails missing, duplicate, mixed or incomplete trials', async () => {
    const scenario = CONVERSATIONS[0]
    const results = []
    for (let trial = 1; trial <= 3; trial++) {
      const inputs: AgentInput[] = []
      results.push(await runConversation(scenario, trial, { dependencies: frozenDependencies(scriptedAgent(inputs)) }))
      expect(inputs[0].messages).toHaveLength(1)
      expect(inputs[0].instructions).toContain('Previous executed search DATA: none')
    }
    expect(new Set(results.map(result => result.sessionId)).size).toBe(3)
    expect(summarizeConversations(results, [scenario], 3)[0]).toMatchObject({ allTrialsPass: true, passed: 3, passRate: 1, variability: 'all-pass' })
    expect(summarizeConversations(results.slice(1), [scenario], 3)[0].allTrialsPass).toBe(false)
    expect(summarizeConversations([results[0], results[0], results[2]], [scenario], 3)[0].allTrialsPass).toBe(false)
    expect(summarizeConversations([results[0], { ...results[1], pass: false }, results[2]], [scenario], 3)[0]).toMatchObject({ allTrialsPass: false, passed: 2, variability: 'mixed' })
    expect(summarizeConversations([{ ...results[0], turns: [] }], [scenario], 1)[0].allTrialsPass).toBe(false)
  })

  it('prevents concurrent searches from starting before the first boundary is captured', async () => {
    const fixtureReads = frozenReadExecutors()
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    let reads = 0
    const result = await orchestrate({ requestId: 'parallel-searches', locale: 'en', originalQuery: 'Free events in Recoleta tonight',
      userContext: { userId: null, isAuthenticated: false }, priorDisplayedEvents: [],
      readExecutors: { search: async (input, context) => { reads++; await pending; return fixtureReads.search(input, context) } },
      runAgentFn: async input => {
        const execute = (input.tools.search_events as unknown as Executable).execute
        const first = execute({ objective: 'search', neighborhoods: ['Recoleta'], isFree: true, timeFilter: 'tonight' }, { toolCallId: 'first', messages: input.messages })
        const second = await execute({ objective: 'search', isFree: true, timeFilter: 'tonight' }, { toolCallId: 'second', messages: input.messages })
        expect(second).toMatchObject({ success: false, error: 'search_in_progress' })
        release()
        await first
        return { text: 'There are no matching events in Recoleta tonight.', responseId: null,
          steps: [{ toolResults: [{ toolCallId: 'first', toolName: 'search_events' }, { toolCallId: 'second', toolName: 'search_events' }] }] }
      },
    })
    expect(reads).toBe(1)
    expect(result.canonical.kind).toBe('no_results')
    expect(result.canonical.events).toEqual([])
  })

  it('records a runner error and cannot pass a truncated conversation', async () => {
    const scenario = CONVERSATIONS[0]
    const result = await runConversation(scenario, 1, { runTurn: async () => { throw new Error('model unavailable') } })
    expect(result.pass).toBe(false)
    expect(result.turns[0].failures).toEqual(['runner: model unavailable'])
    expect(summarizeConversations([result], [scenario], 1)[0].allTrialsPass).toBe(false)
  })

  it('requires complete and matching experiment scores rather than accepting an evaluator error', async () => {
    const output = await runConversation(CONVERSATIONS[0], 1, { dependencies: frozenDependencies(scriptedAgent()) })
    const evaluations = [{ name: 'conversation_pass', value: 1 }, ...output.turns.map(turn => ({ name: `turn_${turn.index + 1}_pass`, value: 1 }))]
    expect(experimentScoresMatch([{ output, evaluations }], 1)).toBe(true)
    expect(experimentScoresMatch([{ output, evaluations: evaluations.slice(0, -1) }], 1)).toBe(false)
    expect(experimentScoresMatch([{ output, evaluations: [{ name: 'conversation_pass', value: 0 }, ...evaluations.slice(1)] }], 1)).toBe(false)
    expect(experimentScoresMatch([{ output, evaluations: [...evaluations, evaluations[0]] }], 1)).toBe(false)
    expect(experimentScoresMatch([{ output: undefined, evaluations }], 1)).toBe(false)
    expect(experimentScoresMatch([], 1)).toBe(false)
  })

  it('fails raw unknown handles and exposes no facets in model-facing event data', async () => {
    let output: unknown
    const agent: AgentRunner = async input => {
      output = await (input.tools.search_events as unknown as Executable).execute({ objective: 'search', limit: 1, venueName: 'Casa SinTexto', timeFilter: 'tonight' }, { toolCallId: 'search', messages: input.messages })
      const selected = (output as PublicEvents).events[0]
      expect(selected).not.toHaveProperty('facets')
      expect(selected).toMatchObject({ description_en: null, description_unavailable: true })
      const failed = await (input.tools.get_event_details as unknown as Executable).execute({ eventRef: frozenEvents()[0].id }, { toolCallId: 'unknown', messages: input.messages })
      expect(failed).toMatchObject({ success: false })
      return { text: 'The source does not provide a description for this event.', steps: [], responseId: null }
    }
    await runConversation({ id: 'unknown', locale: 'en', turns: [{ message: 'Show me the event.', expect: { kind: 'event_details' } }] }, 1, { dependencies: frozenDependencies(agent) })
    expect(output).toBeDefined()
  })

  it('bounds explicit live evaluation options', () => {
    expect(parseMultiTurnOptions([])).toMatchObject({ trials: 3, concurrency: 2, langfuse: false })
    expect(parseMultiTurnOptions(['--history-stress'])).toMatchObject({ historyStress: true })
    expect(parseMultiTurnOptions(['--trials', '5', '--langfuse', '--case', 'ordinal-details-directions-en'])).toMatchObject({ trials: 5, langfuse: true })
    for (const args of [['--trials', '0'], ['--trials', '11'], ['--concurrency', '-1'], ['--trials'], ['--unknown']]) expect(() => parseMultiTurnOptions(args)).toThrow()
  })
})

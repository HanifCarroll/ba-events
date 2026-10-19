import { randomUUID } from 'node:crypto'
import type { SharedChatTurnDependencies } from '#features/chat/api/agent/shared-turn.server.ts'
import type { AgentHistoryMessage } from '#features/chat/api/agent/history.ts'
import { MAX_AGENT_HISTORY_MESSAGES, MAX_AGENT_HISTORY_TEXT } from '#features/chat/api/agent/history.ts'
import { parseDataResponseHint, MAX_PRIOR_GROUPS, type PriorResponseHint } from '#features/chat/api/agent/follow-up.ts'
import { searchContextFromCanonical, type LastSearchContext } from '#features/chat/api/agent/search-context.ts'
import { runConcierge, type AgentRun, type ConciergeEvalContext } from '../lib/run-agent.ts'
import { scoreCase } from './score.ts'
import { frozenDependencies, frozenSearchIntent, FROZEN_DATE } from './frozen-corpus.ts'
import type { ConversationCase, TurnExpectation } from './conversations.ts'
import type { SearchEventsInput } from '#features/chat/api/tools/search-events.ts'
import type { AgentRunner, ModelRunConfiguration } from '#features/chat/api/agent/orchestrate.ts'
import { captureModelEvidence, type ModelEvidence } from './quality.ts'

export interface ModelStepUsage {
  provider: string | null
  model: string | null
  responseModel: string | null
  inputTokens: number | null
  cacheReadTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
}

/** Returned SDK usage only; missing counters and failed attempts remain unknown. */
export function captureModelUsage(run: import('#features/chat/api/agent/orchestrate.ts').AgentRun): ModelStepUsage[] {
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
  return run.steps.map(raw => {
    const step = raw as typeof raw & { response?: { modelId?: string }; model?: { provider?: string; modelId?: string }; usage?: {
      inputTokens?: number; outputTokens?: number; inputTokenDetails?: { cacheReadTokens?: number };
      outputTokenDetails?: { reasoningTokens?: number }; raw?: { prompt_tokens?: number; prompt_cache_hit_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } }
    } }
    const rawUsage = step.usage?.raw
    return { provider: step.model?.provider ?? null, model: step.model?.modelId ?? null, responseModel: step.response?.modelId ?? null,
      inputTokens: count(rawUsage ? rawUsage.prompt_tokens : step.usage?.inputTokens),
      cacheReadTokens: count(rawUsage ? rawUsage.prompt_cache_hit_tokens : step.usage?.inputTokenDetails?.cacheReadTokens),
      outputTokens: count(rawUsage ? rawUsage.completion_tokens : step.usage?.outputTokens),
      reasoningTokens: count(rawUsage ? rawUsage.completion_tokens_details?.reasoning_tokens : step.usage?.outputTokenDetails?.reasoningTokens) }
  })
}

export interface TurnResult {
  index: number
  message: string
  pass: boolean
  failures: string[]
  run?: AgentRun
  durationMs: number
  modelUsage?: { steps: ModelStepUsage[]; inputOutputComplete: boolean }
  modelConfiguration?: ModelRunConfiguration
}
export interface ConversationResult {
  caseId: string
  trial: number
  sessionId: string
  pass: boolean
  turns: TurnResult[]
}
export type TurnRunner = typeof runConcierge

export const HISTORY_STRESS_VERSION = 'old-dialogue-padding-v1'
export const HISTORY_STRESS_MESSAGES: AgentHistoryMessage[] = Array.from({ length: 12 }, (_, index) => ({
  role: index % 2 ? 'assistant' : 'user',
  content: `Earlier unrelated conversation ${index}. ${'Old unrelated background. '.repeat(100)}`.slice(0, MAX_AGENT_HISTORY_TEXT),
}))

export async function scoreConversationTurn(
  id: string, message: string, locale: 'en' | 'es', expectation: TurnExpectation,
  run: AgentRun, previousResults: AgentRun[],
): Promise<string[]> {
  const failures = scoreCase({ id, message, locale, expect: {} }, run).failures
  if (![expectation.kind, ...(expectation.alternativeKinds ?? [])].includes(run.canonical.kind)) failures.push(`kind: expected ${expectation.kind}, got ${run.canonical.kind}`)
  if (expectation.minEvents !== undefined && run.events.length < expectation.minEvents) failures.push(`events: fewer than ${expectation.minEvents}`)
  if (expectation.maxEvents !== undefined && run.events.length > expectation.maxEvents) failures.push(`events: more than ${expectation.maxEvents}`)
  for (const tool of expectation.tools ?? []) {
    if (!run.toolCalls.some(call => call.toolName === tool)) failures.push(`tool: missing ${tool}`)
  }
  for (const tool of expectation.forbiddenTools ?? []) {
    if (run.toolCalls.some(call => call.toolName === tool)) failures.push(`tool: unexpected ${tool}`)
  }
  if (expectation.targetIndex !== undefined) {
    const previous = previousResults.findLast(result => result.events.length > 0)
    const target = previous?.events[expectation.targetIndex]
    if (!target) failures.push('target: prior response did not supply the requested ordinal')
    else if (expectation.kind === 'directions') {
      if (run.canonical.directions?.eventId !== target.id) failures.push('target: directions refer to the wrong event')
    } else {
      // Detail-only follow-ups have grounded reads but intentionally no new card.
      const details = run.toolCalls.filter(call => call.toolName === 'get_event_details')
      if (details.length === 0 || details.some(call => call.eventIds.length !== 1 || call.eventIds[0] !== target.id)) {
        failures.push('target: details refer to the wrong event')
      }
    }
  }
  for (const call of run.toolCalls.filter(call => call.toolName === 'search_events')) {
    const intent = await frozenSearchIntent(call.input as SearchEventsInput)
    if (expectation.neighborhood && !intent.must.neighborhoodIds?.includes(expectation.neighborhood)) failures.push('constraints: neighborhood not preserved')
    if (expectation.isFree && intent.must.isFree !== true) failures.push('constraints: free status not preserved')
    if (expectation.maxPrice !== undefined && (intent.must.maxPrice === undefined || intent.must.maxPrice > expectation.maxPrice)) failures.push('constraints: maximum price not preserved')
    if (expectation.tonight) {
      const after = Date.parse('2026-10-13T18:00:00-03:00')
      const before = Date.parse('2026-10-14T06:00:00-03:00')
      const windows = intent.must.weekdayWindows ?? [{ startsAfter: intent.must.startsAfter, startsBefore: intent.must.startsBefore }]
      if (!windows.length || windows.some(window => !window.startsAfter || !window.startsBefore
        || Date.parse(window.startsAfter) < after || Date.parse(window.startsBefore) > before)) failures.push('constraints: tonight window not preserved')
    }
  }
  for (const event of run.events) {
    if (expectation.neighborhood && event.venue_neighborhood !== expectation.neighborhood) failures.push('events: wrong neighborhood')
    if (expectation.isFree && !event.is_free) failures.push('events: paid option in a free-only request')
    if (expectation.maxPrice !== undefined && (event.price === null || event.price > expectation.maxPrice)) failures.push('events: option exceeds budget')
  }
  return [...new Set(failures)]
}

export async function runConversation(
  scenario: ConversationCase, trial: number,
  options: { runTurn?: TurnRunner; runAgentFn?: AgentRunner; dependencies?: SharedChatTurnDependencies; sessionId?: string; historyStress?: boolean } = {},
): Promise<ConversationResult> {
  const sessionId = options.sessionId ?? `eval-${scenario.id}-${trial}-${randomUUID()}`
  let evidence: ModelEvidence | undefined
  let modelSteps: ModelStepUsage[] = []
  let modelConfiguration: ModelRunConfiguration | undefined
  const dependencies = options.dependencies ?? frozenDependencies(options.runAgentFn, (input, run) => {
    evidence = captureModelEvidence(input, run); modelSteps = captureModelUsage(run); modelConfiguration = run.configuration
  })
  const runTurn = options.runTurn ?? runConcierge
  const priorHints: PriorResponseHint[] = []
  const recentMessages: AgentHistoryMessage[] = options.historyStress ? structuredClone(HISTORY_STRESS_MESSAGES) : []
  const previousResults: AgentRun[] = []
  let lastSearch: LastSearchContext | null = null
  const turns: TurnResult[] = []

  for (const [index, turn] of scenario.turns.entries()) {
    const started = performance.now()
    try {
      evidence = undefined
      modelSteps = []
      modelConfiguration = undefined
      const context: Partial<ConciergeEvalContext> = {
        sessionId, currentDateInBA: FROZEN_DATE, capturePerformance: true, priorHints: structuredClone(priorHints),
        recentMessages: structuredClone(recentMessages), lastSearch: structuredClone(lastSearch),
      }
      const run = await runTurn(turn.message, scenario.locale, context, dependencies)
      if (evidence) run.modelEvidence = evidence
      const failures = await scoreConversationTurn(`${scenario.id}/turn-${index + 1}`, turn.message, scenario.locale, turn.expect, run, previousResults)
      turns.push({ index, message: turn.message, run, pass: !failures.length, failures, durationMs: Math.round(performance.now() - started),
        modelConfiguration,
        modelUsage: { steps: modelSteps, inputOutputComplete: modelSteps.length > 0 && modelSteps.every(step => step.inputTokens !== null && step.outputTokens !== null) } })
      previousResults.push(run)

      // Carry actual output through the same parsers and bounds used by production.
      const hint = parseDataResponseHint(run.canonical)
      if (!hint) throw new Error('Canonical response cannot be parsed as follow-up context')
      if (hint.events.length) {
        priorHints.push({ ...hint, assistantMessageId: `${sessionId}-assistant-${index}`, createdAt: null })
        if (priorHints.length > MAX_PRIOR_GROUPS) priorHints.shift()
      }
      lastSearch = searchContextFromCanonical(run.canonical) ?? lastSearch
      const assistantText = [run.text, ...run.events.map(event => event.recommendation_reason ?? '')].filter(Boolean).join('\n')
      recentMessages.push({ role: 'user', content: turn.message.slice(0, MAX_AGENT_HISTORY_TEXT) },
        { role: 'assistant', content: assistantText.slice(0, MAX_AGENT_HISTORY_TEXT) })
      recentMessages.splice(0, Math.max(0, recentMessages.length - MAX_AGENT_HISTORY_MESSAGES))
    } catch (error) {
      const failure = `runner: ${error instanceof Error ? error.message : String(error)}`
      const existing = turns.find(turn => turn.index === index)
      if (existing) { existing.failures.push(failure); existing.pass = false }
      else turns.push({ index, message: turn.message, pass: false, failures: [failure], durationMs: Math.round(performance.now() - started) })
      break
    }
  }
  return { caseId: scenario.id, trial, sessionId, turns,
    pass: turns.length === scenario.turns.length && turns.every(turn => turn.pass) }
}

export function summarizeConversations(results: ConversationResult[], cases: ConversationCase[], trials: number) {
  return cases.map(scenario => {
    const runs = results.filter(result => result.caseId === scenario.id)
    const passed = runs.filter(result => result.pass).length
    const complete = runs.length === trials && new Set(runs.map(run => run.trial)).size === trials
      && runs.every(run => run.trial >= 1 && run.trial <= trials && run.turns.length === scenario.turns.length)
    return { caseId: scenario.id, expectedTrials: trials, completedTrials: runs.length, passed,
      passRate: passed / trials, allTrialsPass: complete && passed === trials,
      variability: passed > 0 && passed < trials ? 'mixed' : passed === trials ? 'all-pass' : 'all-fail' }
  })
}

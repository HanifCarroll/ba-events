#!/usr/bin/env bun
/**
 * Concierge agent eval.
 *
 * Runs each case through the real agent (model + tools + dev DB, anonymous
 * context) and scores deterministically:
 *   - per-case expectations (tool choice, limits, filter args, scope)
 *   - global voice rules (no exclamations, no meta-narration, no pressure)
 *   - locale (Spanish query -> Spanish reply)
 *   - grounding (reply mentions only events the tools returned)
 *
 * Usage: bun evals/concierge/run.ts
 */
import { runConcierge, type AgentRun } from '../lib/run-agent'
import {
  detectLanguage,
  mapWithConcurrency,
  mentionsReturnedEvent,
  voiceViolations,
} from '../lib/checks'
import { printReport, type CaseResult } from '../lib/report'
import { CONCIERGE_CASES, type ConciergeCase } from './cases'

const SEARCH_LIKE_TOOLS = ['search_events']
const DEFAULT_LIMIT: Record<string, number> = {
  search_events: 1,
}

function scoreCase(c: ConciergeCase, run: AgentRun): CaseResult {
  const failures: string[] = []
  const e = c.expect

  // Tool expectations
  if (e.noTools && run.toolCalls.length > 0) {
    failures.push(`expected no tool calls, got ${run.toolCalls.map((t) => t.toolName).join(', ')}`)
  }
  if (e.anyToolOf && !run.toolCalls.some((t) => e.anyToolOf!.includes(t.toolName))) {
    const askedQuestion = run.text.includes('?')
    if (!(e.allowQuestionInstead && run.toolCalls.length === 0 && askedQuestion)) {
      failures.push(
        run.toolCalls.length === 0
          ? `expected one of [${e.anyToolOf.join(', ')}], no tools called`
          : `expected one of [${e.anyToolOf.join(', ')}], got ${run.toolCalls.map((t) => t.toolName).join(', ')}`
      )
    }
  }

  // Limit bounds on search-like calls
  for (const call of run.toolCalls.filter((t) => SEARCH_LIKE_TOOLS.includes(t.toolName))) {
    const eff = (call.input.limit as number | undefined) ?? DEFAULT_LIMIT[call.toolName]
    if (e.limitMax !== undefined && eff > e.limitMax) {
      failures.push(`${call.toolName} effective limit ${eff} > max ${e.limitMax}`)
    }
    if (e.limitMin !== undefined && eff < e.limitMin) {
      failures.push(`${call.toolName} effective limit ${eff} < min ${e.limitMin}`)
    }
  }

  // search_events argument checks
  const search = run.toolCalls.find((t) => t.toolName === 'search_events')
  if (e.searchArgs) {
    if (!search) {
      failures.push('expected search_events call for argument checks')
    } else {
      for (const [key, want] of Object.entries(e.searchArgs)) {
        const got = search.input[key]
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          failures.push(`search_events.${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
        }
      }
    }
  }
  if (e.maxPriceLte !== undefined) {
    const maxPrice = search?.input.maxPrice as number | undefined
    if (maxPrice === undefined) failures.push('search_events.maxPrice not set')
    else if (maxPrice > e.maxPriceLte) failures.push(`search_events.maxPrice ${maxPrice} > ${e.maxPriceLte}`)
  }

  // Text rules
  if (e.forbid && e.forbid.test(run.text)) {
    failures.push(`reply matched forbidden pattern ${e.forbid}`)
  }
  if (e.custom) {
    const failure = e.custom(run)
    if (failure) failures.push(failure)
  }

  // Global: voice — blocking violations fail outright; cosmetic slips warn
  // and only fail when they repeat (>= 2) in the same reply. A single cosmetic
  // slip (e.g. a stray "let me check") no longer blocks the gate, but it is
  // surfaced on the case note.
  const voice = voiceViolations(run.text)
  for (const v of voice.filter((v) => v.blocking)) failures.push(`voice: ${v.kind}`)
  const cosmetic = voice.filter((v) => !v.blocking)
  if (cosmetic.length >= 2) {
    failures.push(`voice: ${cosmetic.length} cosmetic slips (${cosmetic.map((v) => v.kind).join(', ')})`)
  }

  // Global: locale
  if (run.text.trim() && detectLanguage(run.text) !== c.locale) {
    failures.push(`locale: expected ${c.locale} reply, detected ${detectLanguage(run.text)}`)
  }

  // Global: grounding — reply must reference an event the tools returned
  if (!e.allowQuestionInstead && run.events.length > 0 && run.text.trim()) {
    if (!mentionsReturnedEvent(run.text, run.events.map((ev) => ev.name))) {
      failures.push('grounding: reply mentions none of the returned events')
    }
  }

  return {
    id: c.id,
    pass: failures.length === 0,
    failures,
    note: `${run.toolCalls.map((t) => t.toolName).join('+') || 'no-tools'}, ${run.events.length} events${
      cosmetic.length === 1 ? ` · ${cosmetic[0].kind}` : ''
    }`,
  }
}

console.log(`Running ${CONCIERGE_CASES.length} concierge cases (concurrency 4)...`)
const results = await mapWithConcurrency(CONCIERGE_CASES, 4, async (c) => {
  try {
    const run = await runConcierge(c.message, c.locale)
    return scoreCase(c, run)
  } catch (error) {
    return { id: c.id, pass: false, failures: [`runner error: ${String(error)}`] }
  }
})

printReport('concierge', results)

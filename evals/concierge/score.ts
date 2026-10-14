import type { AgentRun } from "../lib/run-agent.ts"
import { voiceViolations } from "../lib/checks.ts"
import { detectReplyLanguage } from './language.ts'
import type { CaseResult } from "../lib/report.ts"
import type { ConciergeCase } from "./cases.ts"

const SEARCH_LIKE_TOOLS = ['search_events']
const DEFAULT_LIMIT: Record<string, number> = {
  search_events: 1,
}

export function scoreCase(c: ConciergeCase, run: AgentRun): CaseResult {
  const failures: string[] = []
  const e = c.expect

  // Tool expectations
  if (e.noTools && run.toolCalls.length > 0) {
    failures.push(`expected no tool calls, got ${run.toolCalls.map((t) => t.toolName).join(', ')}`)
  }
  if (e.anyToolOf && !run.toolCalls.some((t) => e.anyToolOf!.includes(t.toolName))) {
    const askedQuestion = run.text.includes('?')
    if (!(e.allowQuestionInstead && askedQuestion && run.toolCalls.every((tool) => tool.toolName === 'ask_clarification'))) {
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

  // Global: canonical trust boundary and generation outcome.
  if (!run.cardsGrounded) failures.push("grounding: displayed card lacks a successful credited read")
  if (run.canonical.operations.length) failures.push("read-only: concierge emitted a mutation")
  if (run.canonical.provenance.fallbackUsed) failures.push("generation: fallback response")

  // Global: locale
  if (run.text.trim() && detectReplyLanguage(run.text) !== c.locale) {
    failures.push(`locale: expected ${c.locale} reply, detected ${detectReplyLanguage(run.text)}`)
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

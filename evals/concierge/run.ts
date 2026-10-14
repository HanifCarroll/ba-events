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
import { runConcierge, type AgentRun } from '../lib/run-agent.ts'
import {
  mapWithConcurrency,
} from '../lib/checks.ts'
import { printReport, type CaseResult } from '../lib/report.ts'
import { CONCIERGE_CASES } from './cases.ts'

import { scoreCase } from "./score.ts"

const caseFilter = process.argv[2]
const cases = caseFilter
  ? CONCIERGE_CASES.filter((c) => c.id === caseFilter)
  : CONCIERGE_CASES

if (cases.length === 0) {
  console.error(`No concierge case matches filter "${caseFilter}"`)
  process.exit(2)
}

const concurrency = 2
console.log(`Running ${cases.length} concierge case(s) (concurrency ${concurrency})...`)
const results = await mapWithConcurrency(cases, concurrency, async (c) => {
  try {
    const run = await runConcierge(c.message, c.locale)
    return scoreCase(c, run)
  } catch (error) {
    return { id: c.id, pass: false, failures: [`runner error: ${String(error)}`] }
  }
})

printReport('concierge', results)

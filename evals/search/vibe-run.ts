#!/usr/bin/env bun
/**
 * Vibe-search retrieval eval.
 *
 * Runs the labeled bilingual golden set through the same path the
 * search_events tool uses for vibe queries (detectVibeIntent →
 * rankVibeMatches over the complete candidate set) against the deterministic
 * fixture corpus. The scorer is pure, so this run is reproducible.
 *
 * Per-case pass = every relevant fixture returned, no irrelevant fixture
 * returned, and (when declared) the `top` fixture ranks first.
 * Suite fails if any case fails.
 *
 * Usage: bun evals/search/vibe-run.ts
 */
import { detectVibeIntent, rankVibeMatches } from '@/features/chat/api/tools/vibe-search'
import { VIBE_FIXTURES } from './vibe-fixtures'
import { VIBE_GOLDEN_QUERIES } from './vibe-golden'

interface CaseResult {
  query: string
  intentRouted: boolean
  relevantFound: string[]
  relevantMissing: string[]
  falsePositives: string[]
  topMatches: boolean
  returned: string[]
}

const results: CaseResult[] = VIBE_GOLDEN_QUERIES.map((golden) => {
  const intent = detectVibeIntent(golden.query)
  const ranked = intent
    ? rankVibeMatches(VIBE_FIXTURES, golden.query, intent, 10)
    : { events: [] as typeof VIBE_FIXTURES }
  const returnedIds = ranked.events.map((event) => event.id)

  const relevantSet = new Set(golden.relevant)
  const irrelevantSet = new Set(golden.irrelevant)

  return {
    query: golden.query,
    intentRouted: !!intent,
    relevantFound: returnedIds.filter((id) => relevantSet.has(id)),
    relevantMissing: golden.relevant.filter((id) => !returnedIds.includes(id)),
    falsePositives: returnedIds.filter((id) => irrelevantSet.has(id)),
    topMatches: golden.top ? returnedIds[0] === golden.top : true,
    returned: returnedIds,
  }
})

let failed = 0
console.log('\n=== vibe-search ===')
for (const r of results) {
  const problems: string[] = []
  if (!r.intentRouted) problems.push('not routed as vibe query')
  if (r.relevantMissing.length > 0) problems.push(`missing: ${r.relevantMissing.join(', ')}`)
  if (r.falsePositives.length > 0) problems.push(`false positives: ${r.falsePositives.join(', ')}`)
  if (!r.topMatches) problems.push(`top mismatch (got ${r.returned[0] ?? 'none'})`)
  if (problems.length > 0) failed++

  console.log(
    `${problems.length === 0 ? 'PASS' : 'FAIL'}  "${r.query}"  ` +
      `found: ${r.relevantFound.join(', ') || '-'}  ` +
      (problems.length > 0 ? `problems: ${problems.join('; ')}` : '')
  )
}

console.log(`\n${results.length - failed}/${results.length} cases passed`)
if (failed > 0) process.exitCode = 1

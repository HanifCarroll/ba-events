#!/usr/bin/env bun
/**
 * Unblind a graded worksheet back into a static labels module.
 *
 * Reads a blind-pool key and a graded JSON produced by a blinded judge, then
 * writes a static TypeScript module exporting `LIVE_LABELS` as
 * `Record<string, Record<string, 0 | 1 | 2 | 3>>`. The module performs no
 * runtime file reads — the labels are fully inlined.
 *
 * Graded JSON contract:
 *   {
 *     "provenance": "string",
 *     "grades": {
 *       "opaque-option-id": { "grade": 0, "rationale": "string" }
 *     }
 *   }
 *
 * Validation is strict and rejects anything that would silently corrupt the
 * label set: option-ID sets must match the key exactly, grades must be
 * integers 0..3, rationales must be nonempty, and no option may map to a
 * duplicated query/event pair.
 *
 * Usage:
 *   bun evals/search/relevance/unblind-labels.ts \
 *     --key ./holdout-key.json \
 *     --grades ./holdout-graded.json \
 *     --out ./holdout-labels.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

type Grade = 0 | 1 | 2 | 3

// ============================================================================
// CLI
// ============================================================================

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const keyArg = argValue('--key')
const gradesArg = argValue('--grades')
const outArg = argValue('--out')

if (!keyArg || !gradesArg || !outArg) {
  console.error('usage: unblind-labels.ts --key <key-json> --grades <graded-json> --out <labels-ts>')
  process.exit(1)
}

const KEY_PATH = resolve(process.cwd(), keyArg)
const GRADES_PATH = resolve(process.cwd(), gradesArg)
const OUT_PATH = resolve(process.cwd(), outArg)

// ============================================================================
// Input shapes
// ============================================================================

interface KeyOption {
  optionId: string
  eventId: string
}

interface KeyQuery {
  queryId: string
  options: KeyOption[]
}

interface GradedEntry {
  grade: number
  rationale: string
}

interface GradedFile {
  provenance: string
  grades: Record<string, GradedEntry>
}

const key = JSON.parse(readFileSync(KEY_PATH, 'utf-8')) as { queries: KeyQuery[] }
const graded = JSON.parse(readFileSync(GRADES_PATH, 'utf-8')) as GradedFile

// ============================================================================
// Validation
// ============================================================================

const keyOptionIds: string[] = []
const keyByOption = new Map<string, { queryId: string; eventId: string }>()
const seenPairs = new Set<string>()

for (const q of key.queries) {
  for (const o of q.options) {
    keyOptionIds.push(o.optionId)
    if (keyByOption.has(o.optionId)) {
      throw new Error(`duplicate optionId in key: ${o.optionId}`)
    }
    keyByOption.set(o.optionId, { queryId: q.queryId, eventId: o.eventId })
    const pair = `${q.queryId}|${o.eventId}`
    if (seenPairs.has(pair)) {
      throw new Error(`duplicate query/event mapping in key: ${pair}`)
    }
    seenPairs.add(pair)
  }
}

const gradedOptionIds = Object.keys(graded.grades)
const keySet = new Set(keyOptionIds)
const gradedSet = new Set(gradedOptionIds)

if (keySet.size !== keyOptionIds.length) {
  throw new Error('duplicate optionId detected in key list')
}
for (const o of keyOptionIds) {
  if (!gradedSet.has(o)) throw new Error(`optionId in key but missing from grades: ${o}`)
}
for (const o of gradedOptionIds) {
  if (!keySet.has(o)) throw new Error(`optionId in grades but missing from key: ${o}`)
}

for (const o of keyOptionIds) {
  const entry = graded.grades[o]
  if (entry === undefined) throw new Error(`missing grade entry for ${o}`)
  const g = entry.grade
  if (!Number.isInteger(g) || g < 0 || g > 3) {
    throw new Error(`invalid grade for ${o}: ${JSON.stringify(g)} (must be integer 0..3)`)
  }
  if (typeof entry.rationale !== 'string' || entry.rationale.trim().length === 0) {
    throw new Error(`missing/empty rationale for ${o}`)
  }
}

// ============================================================================
// Build the static labels module (query order and option order follow the key)
// ============================================================================

const labels: Record<string, Record<string, Grade>> = {}
for (const q of key.queries) {
  const events: Record<string, Grade> = {}
  for (const o of q.options) {
    events[o.eventId] = graded.grades[o.optionId].grade as Grade
  }
  labels[q.queryId] = events
}

const provenance = String(graded.provenance ?? '').replace(/\s+/g, ' ').trim() || '(unspecified)'

const lines: string[] = []
lines.push('/** Graded relevance labels. queryId -> eventId -> 0|1|2|3. */')
lines.push(`// Provenance: ${provenance}`)
lines.push('export const LIVE_LABELS: Record<string, Record<string, 0 | 1 | 2 | 3>> = {')
for (const [queryId, events] of Object.entries(labels)) {
  lines.push(`  '${queryId}': {`)
  for (const [eventId, grade] of Object.entries(events)) {
    lines.push(`    '${eventId}': ${grade},`)
  }
  lines.push('  },')
}
lines.push('}')

const text = lines.join('\n') + '\n'
mkdirSync(dirname(OUT_PATH), { recursive: true })
writeFileSync(OUT_PATH, text)

const total = Object.values(labels).reduce((s, e) => s + Object.keys(e).length, 0)
console.log(
  `[unblind-labels] ${Object.keys(labels).length} queries, ${total} labels → ${OUT_PATH}`
)
console.log(`[unblind-labels] provenance: ${provenance}`)

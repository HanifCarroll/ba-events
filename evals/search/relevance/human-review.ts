#!/usr/bin/env bun
/**
 * Ranker-blinded 22-case human review packet.
 *
 * Mechanical generation only. No relevance judgment is made here: the frozen
 * holdout capture, the adjudicated holdout labels, and the variant orders are
 * read, never altered.
 *
 * Selection contract (frozen holdout only):
 *   For each scored query, take the top event of pure Voyage (`voyageOrder`)
 *   and the top event of the former production fusion (`fusedOrder(q, 2)`).
 *   Select the query when the two top event IDs differ (top-one disagreement)
 *   OR the adjudicated holdout label of the pure-Voyage top event is grade 0.
 *   Union and de-duplicate by query ID.
 *
 * Known invariants are asserted exactly and the generator exits nonzero on any
 * mismatch: 16 top-one disagreements, 8 pure-Voyage grade-0 tops, 2 overlaps,
 * 22 unique selected queries (and therefore 38 options: 16*2 + 6*1).
 *
 * Outputs:
 *   - a blinded worksheet: opaque sequential case IDs, opaque per-case option
 *     IDs, query text + language, and only human-relevant event evidence
 *     (name, localized summary/description, venue, neighborhood, start time,
 *     price/free, categories, facets) with editable grade/rationale left blank.
 *     The worksheet never exposes event UUIDs, original query IDs, ranker or
 *     source labels, ranks or scores, prior grades, or selection reasons.
 *   - a sealed key that restores identity: caseId -> queryId, optionId ->
 *     eventId, pure/fused(2) top booleans per option, selection-reason booleans
 *     per case, and the existing adjudicated label for later comparison.
 *
 * Randomization is fully deterministic: a documented fixed seed drives a stable
 * PRNG (mulberry32). `Math.random` is never used, and no generated-at clock is
 * written, so re-running with the same inputs and seed is byte-identical.
 *
 * Usage:
 *   bun evals/search/relevance/human-review.ts
 *   bun evals/search/relevance/human-review.ts \
 *     --capture ./holdout-capture.json --labels ./holdout-labels.ts \
 *     --worksheet ./human-review-worksheet.json --key ./human-review-key.json \
 *     --seed 20260816
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  fusedOrder,
  voyageOrder,
  asStringArray,
  asEnergy,
  type CaptureFile,
  type FrozenEvent,
  type FrozenQuery,
} from './frozen-variants.ts'
import { portablePath } from './portable-path.ts'

type Grade = 0 | 1 | 2 | 3
type Labels = Record<string, Record<string, Grade>>

// ============================================================================
// CLI
// ============================================================================

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const captureArg = argValue('--capture')
const labelsArg = argValue('--labels')
const worksheetArg = argValue('--worksheet')
const keyArg = argValue('--key')
const seedArg = argValue('--seed')

const CAPTURE_PATH = captureArg
  ? resolve(process.cwd(), captureArg)
  : new URL('./holdout-capture.json', import.meta.url).pathname
const LABELS_PATH = labelsArg
  ? resolve(process.cwd(), labelsArg)
  : new URL('./holdout-labels.ts', import.meta.url).pathname
const WORKSHEET_PATH = worksheetArg
  ? resolve(process.cwd(), worksheetArg)
  : new URL('./human-review-worksheet.json', import.meta.url).pathname
const KEY_PATH = keyArg
  ? resolve(process.cwd(), keyArg)
  : new URL('./human-review-key.json', import.meta.url).pathname

/** Documented deterministic default seed (no `Math.random` anywhere). */
const DEFAULT_SEED = 20260816
const SEED = (() => {
  if (seedArg === undefined) return DEFAULT_SEED
  const n = Number(seedArg)
  if (!Number.isInteger(n)) {
    throw new Error(`--seed must be an integer, got: ${JSON.stringify(seedArg)}`)
  }
  return n
})()

// ============================================================================
// Input loading
// ============================================================================

const capture: CaptureFile = JSON.parse(readFileSync(CAPTURE_PATH, 'utf-8'))
const { LIVE_LABELS } = (await import(pathToFileURL(LABELS_PATH).href)) as {
  LIVE_LABELS: Labels
}

// ============================================================================
// Deterministic PRNG (never Math.random)
// ============================================================================

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ============================================================================
// Selection
// ============================================================================

interface Selected {
  q: FrozenQuery
  pureTop: string
  fusedTop: string
  topOneDisagreement: boolean
  pureTopWasGradeZero: boolean
}

function selectQueries(): Selected[] {
  const selected: Selected[] = []
  for (const q of capture.queries) {
    if (q.baseOrder.length === 0) continue // not a scored query

    const pureTop = voyageOrder(q)[0]
    const fusedTop = fusedOrder(q, 2)[0]
    if (pureTop === undefined || fusedTop === undefined) {
      throw new Error(`scored query ${q.id} has no top event`)
    }

    // Both top event IDs must exist in the frozen capture before any selection
    // predicate runs; a missing top must never silently skip a query.
    if (!capture.events[pureTop]) {
      throw new Error(`scored query ${q.id} pure top event missing from capture: ${pureTop}`)
    }
    if (!capture.events[fusedTop]) {
      throw new Error(`scored query ${q.id} fused top event missing from capture: ${fusedTop}`)
    }

    // The pure top must carry an explicit adjudicated label (grade 0 included).
    // A missing label is a data error, not a "nonzero grade" — treating it as
    // nonzero here would silently omit the case before selection runs.
    const pureTopGrade = LIVE_LABELS[q.id]?.[pureTop]
    if (pureTopGrade === undefined || pureTopGrade === null) {
      throw new Error(
        `scored query ${q.id} pure top event missing its adjudicated label: ${pureTop}`
      )
    }
    const pureTopWasGradeZero = pureTopGrade === 0

    const topOneDisagreement = pureTop !== fusedTop

    // When the tops disagree both options are presented, so the fused top needs
    // an explicit label too before we commit to selecting it (grade 0 valid).
    if (topOneDisagreement) {
      const fusedTopGrade = LIVE_LABELS[q.id]?.[fusedTop]
      if (fusedTopGrade === undefined || fusedTopGrade === null) {
        throw new Error(
          `scored query ${q.id} fused top event missing its adjudicated label: ${fusedTop}`
        )
      }
    }

    if (!topOneDisagreement && !pureTopWasGradeZero) continue

    selected.push({ q, pureTop, fusedTop, topOneDisagreement, pureTopWasGradeZero })
  }
  return selected
}

const selected = selectQueries()

// ============================================================================
// Invariant assertions (fail nonzero on any mismatch)
// ============================================================================

const disagreementCount = selected.filter((s) => s.topOneDisagreement).length
const gradeZeroCount = selected.filter((s) => s.pureTopWasGradeZero).length
const overlapCount = selected.filter((s) => s.topOneDisagreement && s.pureTopWasGradeZero).length
const uniqueCount = selected.length

const expected = { disagreements: 16, gradeZero: 8, overlap: 2, unique: 22 }
if (
  disagreementCount !== expected.disagreements ||
  gradeZeroCount !== expected.gradeZero ||
  overlapCount !== expected.overlap ||
  uniqueCount !== expected.unique
) {
  console.error(`[human-review] invariant mismatch (selection contract changed):`)
  console.error(`  top-one disagreements: ${disagreementCount} (expected ${expected.disagreements})`)
  console.error(`  pure-Voyage grade-0 tops: ${gradeZeroCount} (expected ${expected.gradeZero})`)
  console.error(`  overlaps: ${overlapCount} (expected ${expected.overlap})`)
  console.error(`  unique selected: ${uniqueCount} (expected ${expected.unique})`)
  process.exit(1)
}

// ============================================================================
// Evidence helpers (worksheet-only, never ranker/source data)
// ============================================================================

function pickLocalized(
  lang: FrozenQuery['lang'],
  es: string | null,
  en: string | null
): string | null {
  if (lang === 'en') return en ?? es
  return es ?? en
}

function facetSummary(e: FrozenEvent): Record<string, unknown> {
  return {
    genres: asStringArray(e.facets.genres) ?? [],
    vibes: asStringArray(e.facets.vibes) ?? asStringArray(e.facets.vibe) ?? [],
    activities: asStringArray(e.facets.activities) ?? asStringArray(e.facets.activity) ?? [],
    audience: asStringArray(e.facets.audience) ?? asStringArray(e.facets.audiences) ?? [],
    setting: asStringArray(e.facets.setting) ?? asStringArray(e.facets.settings) ?? [],
    energy: asEnergy(e.facets.energy) ?? null,
    eventType: asStringArray(e.facets.eventType) ?? asStringArray(e.facets.event_type) ?? [],
  }
}

// ============================================================================
// Build worksheet + key
// ============================================================================

const rng = mulberry32(SEED)
let optionCounter = 0

const worksheetCases: unknown[] = []
const keyCases: unknown[] = []

// Deterministic shuffle of the case order hides the capture/selection order.
const caseOrder = shuffled(selected, rng)

for (let ci = 0; ci < caseOrder.length; ci++) {
  const sel = caseOrder[ci]
  const q = sel.q

  const caseId = `case-${String(ci + 1).padStart(2, '0')}`

  // Unique union of the pure and fused top events: two options on disagreement,
  // one option when both top events are identical.
  const optionEvents = [...new Set([sel.pureTop, sel.fusedTop])]
  const presented = shuffled(optionEvents, rng)

  const worksheetOptions: unknown[] = []
  const keyOptions: unknown[] = []

  for (const eventId of presented) {
    const e = capture.events[eventId]
    if (!e) {
      throw new Error(`selected event missing from capture: query=${q.id} event=${eventId}`)
    }
    const existingGrade = LIVE_LABELS[q.id]?.[eventId]
    if (existingGrade === undefined || existingGrade === null) {
      throw new Error(`selected event missing its adjudicated label: query=${q.id} event=${eventId}`)
    }

    const optionId = `op-${String(++optionCounter).padStart(4, '0')}`

    worksheetOptions.push({
      optionId,
      name: e.name,
      summary: pickLocalized(q.lang, e.description_summary_es, e.description_summary_en),
      description:
        (pickLocalized(q.lang, e.description_es, e.description_en) ?? '').slice(0, 400) || null,
      venue: e.venue_name,
      neighborhood: e.venue_neighborhood,
      starts_at: e.starts_at,
      is_free: e.is_free,
      price: e.price,
      categories: e.categories,
      facets: facetSummary(e),
      grade: null,
      rationale: '',
    })

    keyOptions.push({
      optionId,
      eventId,
      isPureTop: eventId === sel.pureTop,
      isFusedTop: eventId === sel.fusedTop,
      existingGrade,
    })
  }

  worksheetCases.push({
    caseId,
    query: q.query,
    lang: q.lang,
    options: worksheetOptions,
  })

  keyCases.push({
    caseId,
    queryId: q.id,
    topOneDisagreement: sel.topOneDisagreement,
    pureTopWasGradeZero: sel.pureTopWasGradeZero,
    options: keyOptions,
  })
}

// ============================================================================
// Serialize (stable 2-space JSON + trailing newline; no generated-at clock)
// ============================================================================

const RUBRIC: Record<string, string> = {
  '0': 'irrelevant / contradicts the request',
  '1': 'marginal',
  '2': 'good / relevant',
  '3': 'excellent / ideal',
}

const worksheet = {
  meta: {
    seed: SEED,
    capturedAt: capture.meta.capturedAt,
    rubric: RUBRIC,
    instructions:
      'Grade each option independently on the 0-3 rubric below. Each case has one or two ' +
      'options; judge every option on its own merit for the given query rather than ranking ' +
      'options against each other. Fill `grade` with an integer 0-3 and `rationale` with a ' +
      'short justification for every option. Do not edit any other field.',
    counts: {
      cases: uniqueCount,
      options: optionCounter,
    },
    note:
      'Blinded review worksheet. Case and option IDs are opaque; only human-relevant event evidence ' +
      'is shown. Fill grade (0-3) and rationale per option.',
  },
  cases: worksheetCases,
}

const key = {
  meta: {
    seed: SEED,
    capture: portablePath(CAPTURE_PATH),
    labels: portablePath(LABELS_PATH),
    capturedAt: capture.meta.capturedAt,
    note:
      'Sealed identity key for the blinded worksheet. caseId -> queryId, optionId -> eventId ' +
      '(option IDs are globally unique, so every worksheet option reverses exactly once), plus ' +
      'pure/fused(2) top booleans per option, selection-reason booleans per case, and the existing ' +
      'adjudicated label for after-the-human comparison only.',
  },
  cases: keyCases,
}

writeFileSync(WORKSHEET_PATH, JSON.stringify(worksheet, null, 2) + '\n')
writeFileSync(KEY_PATH, JSON.stringify(key, null, 2) + '\n')

// ============================================================================
// Report
// ============================================================================

console.log(`[human-review] selected ${uniqueCount} queries`)
console.log(`[human-review]   top-one disagreements: ${disagreementCount}`)
console.log(`[human-review]   pure-Voyage grade-0 tops: ${gradeZeroCount}`)
console.log(`[human-review]   overlaps: ${overlapCount}`)
console.log(`[human-review]   options: ${optionCounter} (16*2 + 6*1 = 38)`)
console.log(`[human-review] worksheet → ${WORKSHEET_PATH}`)
console.log(`[human-review] key       → ${KEY_PATH}`)

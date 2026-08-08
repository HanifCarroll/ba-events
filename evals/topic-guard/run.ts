#!/usr/bin/env bun
/**
 * Topic-guard eval.
 *
 * Calls the real classifier (guardForOffTopic) on candidate assistant replies
 * and reports refusal accuracy: off-topic replies must be replaced, on-topic
 * and near-boundary replies must pass through.
 *
 * Usage: bun evals/topic-guard/run.ts
 */
import { guardForOffTopic } from '@/features/chat/api/topic-guard'
import { mapWithConcurrency } from '../lib/checks'
import { printReport, type CaseResult } from '../lib/report'
import { TOPIC_GUARD_CASES } from './cases'

console.log(`Running ${TOPIC_GUARD_CASES.length} topic-guard cases...`)
const results = await mapWithConcurrency(TOPIC_GUARD_CASES, 6, async (c): Promise<CaseResult> => {
  try {
    const guarded = await guardForOffTopic(c.reply, c.locale)
    const refused = guarded !== null
    const pass = refused === c.expectRefusal
    return {
      id: c.id,
      pass,
      failures: pass
        ? []
        : [
            c.expectRefusal
              ? 'off-topic reply passed through (false negative)'
              : 'on-topic reply was refused (false positive)',
          ],
      note: c.expectRefusal ? 'expect refusal' : 'expect pass-through',
    }
  } catch (error) {
    return { id: c.id, pass: false, failures: [`runner error: ${String(error)}`] }
  }
})

const falsePositives = results.filter((r) => !r.pass && r.note === 'expect pass-through').length
const falseNegatives = results.filter((r) => !r.pass && r.note === 'expect refusal').length
printReport('topic-guard', results, [
  `false positives (wrongly refused): ${falsePositives}`,
  `false negatives (wrongly passed): ${falseNegatives}`,
])

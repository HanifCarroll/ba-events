#!/usr/bin/env bun
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { AI_MODEL } from '#shared/lib/ai/constants.ts'
import { mapWithConcurrency } from '../lib/checks.ts'
import { QUALITY_CONTROLS } from './quality-controls.ts'
import { judgeQuality, QualityGradeError } from './judge.ts'
import { qualityPacket, qualityScores, QUALITY_RUBRIC_HASH } from './quality.ts'

async function main() {
  const model = process.env.AI_EVAL_JUDGE_MODEL?.trim() || AI_MODEL
  const rows = await mapWithConcurrency(QUALITY_CONTROLS, 2, async control => {
    try {
      const judged = await judgeQuality(qualityPacket(control.message, control.locale, control.run), model)
      const scores = qualityScores(control.run, judged.grade)
      const pass = scores.factuality === control.expectedFactuality
        && (!('expectedSuitability' in control) || scores.suitability === control.expectedSuitability)
        && (!('expectedExplanationAccuracy' in control) || scores.explanationAccuracy === control.expectedExplanationAccuracy)
      console.log(`${pass ? 'PASS' : 'FAIL'} ${control.id}`)
      return { id: control.id, status: 'graded', pass, scores, ...judged }
    } catch (error) {
      const reason = error instanceof Error && (error.name === 'ZodError' || error.message.startsWith('Judge') || error.message.includes('applicability'))
        ? error.message : 'Judge request or structured output failed'
      console.log(`ERROR ${control.id}: ${reason}`)
      return { id: control.id, status: 'error', pass: false, error: reason,
        ...(error instanceof QualityGradeError ? { rejectedGrade: error.candidate, attempts: error.attempts } : {}) }
    }
  })
  const directory = new URL('../../results/evals/concierge/', import.meta.url)
  await mkdir(directory, { recursive: true })
  const path = new URL(`judge-controls-${randomUUID()}.json`, directory)
  await writeFile(path, JSON.stringify({ metadata: { model, rubricHash: QUALITY_RUBRIC_HASH, labelSource: 'developer-authored diagnostic expectations; not human calibration' }, results: rows }, null, 2))
  console.log('Report: ' + path.pathname)
  if (rows.some(row => !row.pass)) process.exitCode = 1
}
if (import.meta.main) main().catch(() => { console.error('Judge control setup failed'); process.exitCode = 1 })

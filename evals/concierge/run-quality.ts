#!/usr/bin/env bun
import { randomUUID, createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { LangfuseClient } from '@langfuse/client'
import { AI_MODEL, AI_BASE_URL } from '#shared/lib/ai/constants.ts'
import { mapWithConcurrency } from '../lib/checks.ts'
import { CONVERSATIONS } from './conversations.ts'
import { judgeQuality, QualityGradeError } from './judge.ts'
import { qualityPacket, qualityScores, QUALITY_RUBRIC_HASH, QUALITY_RUBRIC_VERSION } from './quality.ts'
import type { ConversationResult } from './conversation-runner.ts'

async function main() {
  const args = process.argv.slice(2)
  let reportPath = '', model = process.env.AI_EVAL_JUDGE_MODEL?.trim() || AI_MODEL, caseId = '', langfuse = false
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--langfuse') langfuse = true
    else if (args[index] === '--help') { console.log('bun run eval:concierge:quality --report PATH [--model DEEPSEEK_MODEL] [--case ID] [--langfuse]'); return }
    else if (['--report', '--model', '--case'].includes(args[index]) && args[index + 1] && !args[index + 1].startsWith('--')) {
      const key = args[index], value = args[++index]
      if (key === '--report') reportPath = value
      else if (key === '--model') model = value
      else caseId = value
    } else throw new Error('Invalid quality evaluation option')
  }
  if (!reportPath) throw new Error('--report is required')
  const source = await readFile(reportPath, 'utf8')
  const report = JSON.parse(source) as { metadata: { runId: string; configuredModel: string; corpusHash: string; casesHash: string }; summary: Array<{ caseId: string; expectedTrials: number }>; results: ConversationResult[]; experiment?: { traces: Array<{ caseId: string; trial: number; traceId?: string }> } }
  for (const summary of report.summary) {
    const scenario = CONVERSATIONS.find(item => item.id === summary.caseId)
    const trials = report.results.filter(item => item.caseId === summary.caseId)
    if (!scenario || !Number.isInteger(summary.expectedTrials) || summary.expectedTrials < 1 || trials.length !== summary.expectedTrials
      || new Set(trials.map(item => item.trial)).size !== summary.expectedTrials
      || trials.some(item => item.trial < 1 || item.trial > summary.expectedTrials || item.turns.length !== scenario.turns.length
        || item.turns.some((turn, index) => turn.index !== index || turn.message !== scenario.turns[index].message))) throw new Error('Incomplete source evaluation')
  }
  if (new Set(report.summary.map(item => item.caseId)).size !== report.summary.length
    || report.results.some(item => !report.summary.some(summary => summary.caseId === item.caseId))) throw new Error('Duplicate or unknown source cases')
  // Validate the full input before spending tokens. Older reports cannot supply exact evidence.
  const items = report.results.filter(result => !caseId || result.caseId === caseId).flatMap(result => result.turns.map(turn => {
    const scenario = CONVERSATIONS.find(item => item.id === result.caseId)
    if (!scenario || !turn.run) throw new Error('Missing scenario or completed agent run')
    const trace = report.experiment?.traces.find(trace => trace.caseId === result.caseId && trace.trial === result.trial)
    if (langfuse && !trace?.traceId) throw new Error('Langfuse trace identity missing')
    return { caseId: result.caseId, trial: result.trial, index: turn.index, agentRun: turn.run,
      contractPass: turn.pass, traceId: trace?.traceId,
      packet: qualityPacket(turn.message, scenario.locale, turn.run) }
  }))
  if (!items.length) throw new Error('No turns to grade')
  if (langfuse && !(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY)) throw new Error('Langfuse credentials required')
  const runId = randomUUID()
  const graderSource = await readFile(new URL('./quality.ts', import.meta.url), 'utf8')
  const client = langfuse ? new LangfuseClient() : undefined
  const results = await mapWithConcurrency(items, 2, async item => {
    const identity = { caseId: item.caseId, trial: item.trial, index: item.index, traceId: item.traceId }
    const gradingCompleteId = randomUUID()
    const started = performance.now()
    const gradeReceipt = (complete: boolean) => client?.score.create({ id: gradingCompleteId,
      name: `provisional_turn_${item.index + 1}_gradingComplete`, value: Number(complete), traceId: item.traceId,
      comment: `${QUALITY_RUBRIC_VERSION}; uncalibrated; quality run ${runId}`,
      metadata: { qualityRunId: runId, rubricHash: QUALITY_RUBRIC_HASH, calibration: 'uncalibrated', stage: 'prose-grading' } })
    try {
      const judged = await judgeQuality(item.packet, model)
      const scores = qualityScores(item.agentRun, judged.grade)
      const scoreIds: Record<string, string> = {}
      for (const [name, value] of Object.entries(scores)) {
        if (value === null || !client) continue
        const id = randomUUID()
        scoreIds[name] = id
        client.score.create({ id, name: `provisional_turn_${item.index + 1}_${name}`, value,
          traceId: item.traceId, comment: `${QUALITY_RUBRIC_VERSION}; uncalibrated; quality run ${runId}`,
          metadata: { qualityRunId: runId, rubricHash: QUALITY_RUBRIC_HASH, calibration: 'uncalibrated', judgeModel: model } })
      }
      const pass = item.contractPass && Object.entries(scores).every(([name, score]) => score === null || score >= (['suitability', 'usefulness'].includes(name) ? 2 : 1))
      console.log(`${pass ? 'PASS' : 'REVIEW'} ${item.caseId}/${item.trial}/turn-${item.index + 1}`)
      gradeReceipt(true)
      return { ...identity, status: 'graded' as const, pass, scores, scoreIds, gradingCompleteId,
        durationMs: Math.round(performance.now() - started), ...judged }
    } catch (error) {
      // SDK error objects may contain request/auth details. Persist only a safe category.
      const reason = error instanceof Error && (error.name === 'ZodError' || error.message.startsWith('Judge') || error.message.includes('applicability'))
        ? error.message : 'Judge request or structured output failed'
      console.log(`ERROR ${item.caseId}/${item.trial}/turn-${item.index + 1}: ${reason}`)
      gradeReceipt(false)
      return { ...identity, status: 'error' as const, pass: false, error: reason, gradingCompleteId,
        durationMs: Math.round(performance.now() - started),
        ...(error instanceof QualityGradeError ? { rejectedGrade: error.candidate, attempts: error.attempts } : {}) }
    }
  })
  let exported: boolean | null = client ? false : null
  if (client) {
    try { await client.flush(); exported = true }
    catch { console.error('Quality score export failed') }
  }
  const dimensionNames = ['eventExistence', 'factuality', 'suitability', 'explanationAccuracy', 'usefulness'] as const
  const dimensions = Object.fromEntries(dimensionNames.map(name => {
    const measured = results.flatMap(row => row.status === 'graded' && row.scores[name] !== null ? [row.scores[name]!] : [])
    return [name, { measured: measured.length, notApplicable: results.filter(row => row.status === 'graded' && row.scores[name] === null).length,
      errors: results.filter(row => row.status === 'error').length,
      mean: measured.length ? measured.reduce((total, value) => total + value, 0) / measured.length : null }]
  }))
  const receipt = { metadata: { runId, sourceRunId: report.metadata.runId,
    sourceReportHash: createHash('sha256').update(source).digest('hex'), corpusHash: report.metadata.corpusHash,
    casesHash: report.metadata.casesHash, rubricVersion: QUALITY_RUBRIC_VERSION, rubricHash: QUALITY_RUBRIC_HASH,
    graderSourceHash: createHash('sha256').update(graderSource).digest('hex'),
    judgeModel: model, judgeBaseUrl: new URL(AI_BASE_URL).origin, agentModel: report.metadata.configuredModel,
    temperature: 0, maxProtocolAttempts: 2, calibration: 'uncalibrated', selectedCase: caseId || null, expectedTurns: items.length },
    protocol: { gradedTurns: results.filter(row => row.status === 'graded').length,
      errorTurns: results.filter(row => row.status === 'error').length,
      invalidAttempts: results.reduce((count, row) => count + (row.attempts?.filter(attempt => (attempt as { status?: string }).status === 'invalid').length ?? 0), 0) },
    passed: results.every(result => result.pass) && exported !== false, exported, dimensions, results }
  const outputPath = reportPath.replace(/\.json$/, '') + '.quality-' + runId + '.json'
  await writeFile(outputPath, JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify(dimensions, null, 2))
  console.log('Report: ' + outputPath)
  if (!receipt.passed) process.exitCode = 1
}

if (import.meta.main) main().catch(() => { console.error('Quality evaluation setup failed; check the report, options and evidence version'); process.exitCode = 1 })

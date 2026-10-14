import { describe, expect, it } from 'vitest'
import { captureModelEvidence, qualityPacket, qualityScores, validateQualityGrade, judgeInput, evidenceCatalog, type QualityGrade } from '../../../../../evals/concierge/quality.ts'
import { frozenDependencies } from '../../../../../evals/concierge/frozen-corpus.ts'
import { runConcierge } from '../../../../../evals/lib/run-agent.ts'
import { QUALITY_CONTROLS } from '../../../../../evals/concierge/quality-controls.ts'
import { compareHumanReview, renderHumanReview, REVIEW_DIMENSIONS, type ReviewKey, type HumanReview } from '../../../../../evals/concierge/quality-review.ts'
import { judgeQuality, QualityGradeError } from '../../../../../evals/concierge/judge.ts'

const freeSource = judgeInput(qualityPacket('Is it free?', 'en', QUALITY_CONTROLS[0].run)).sourceCatalog.find(source => source.path.endsWith('.is_free'))!.id
const supported: QualityGrade = { claims: [{ proseId: 'P1', claim: 'This event is free.', claimType: 'event_fact', verdict: 'supported', reason: 'Free status is explicit.', sourceIds: [freeSource] }],
  suitability: { score: 2, reason: 'Matches.' }, explanationAccuracy: { score: null, reason: 'No recommendation reason.' },
  usefulness: { score: 2, reason: 'Direct answer.' } }

describe('concierge prose quality evidence and grades', () => {
  it('captures actual transformed model inputs and public tool results without exposing private corpus facets', async () => {
    let evidence: ReturnType<typeof captureModelEvidence> | undefined
    const run = await runConcierge('Tell me about a free event.', 'en', {}, frozenDependencies(async input => {
      const call = { toolCallId: 'read', toolName: 'search_events', input: { objective: 'search', isFree: true, limit: 1 } }
      const output = await (input.tools.search_events as any).execute(call.input, { toolCallId: call.toolCallId, messages: input.messages })
      return { text: 'This event is free.', responseId: null, steps: [{ toolCalls: [call], toolResults: [{ ...call, output }] }] }
    }, (input, result) => { evidence = captureModelEvidence(input, result) }))
    run.modelEvidence = evidence
    expect(evidence?.messages.at(-1)?.content).toBe('Tell me about a free event.')
    const output = evidence?.toolResults[0].output as { events: Array<Record<string, unknown>> }
    expect(output.events[0]).toHaveProperty('eventRef')
    expect(output.events[0]).not.toHaveProperty('facets')
    expect(output).not.toHaveProperty('searchRetryBoundary')
    expect(qualityPacket('Tell me about a free event.', 'en', run).cards[0]).not.toHaveProperty('facets')
    expect(evidence?.activeServerState).toContain('none')
  })

  it('requires exact evidence instead of reconstructing it from a displayed card', () => {
    const run = { ...QUALITY_CONTROLS[0].run, modelEvidence: undefined }
    expect(() => qualityPacket('Is it free?', 'en', run)).toThrow('Exact model evidence missing')
  })

  it('validates catalog citations and rejects failed reads, unavailable sources and nonexistent prose', () => {
    const packet = qualityPacket('Is it free?', 'en', QUALITY_CONTROLS[0].run)
    expect(validateQualityGrade(packet, supported)).toEqual(supported)
    for (const sourceId of ['messages.0.content', '__proto__', 'S99999']) {
      const candidate = structuredClone(supported)
      candidate.claims[0].sourceIds = [sourceId]
      expect(() => validateQualityGrade(packet, candidate)).toThrow()
    }
    const failed = structuredClone(packet)
    failed.evidence.toolResults[0].success = false
    expect(() => validateQualityGrade(failed, supported)).toThrow('non-authoritative')
    const wrongProse = structuredClone(supported)
    wrongProse.claims[0].proseId = 'P99999'
    expect(() => validateQualityGrade(packet, wrongProse)).toThrow('prose absent')
  })

  it('separates existence, factuality and usefulness, including non-applicable outcomes', () => {
    const run = QUALITY_CONTROLS[0].run
    const invented = { ...supported, claims: [{ proseId: 'P1', claim: 'This event is free.', claimType: 'event_fact' as const, verdict: 'unsupported' as const, sourceIds: [], reason: 'No proof.' }] }
    expect(qualityScores(run, invented)).toMatchObject({ eventExistence: 1, factuality: 0, usefulness: 2, explanationAccuracy: null })
    expect(qualityScores({ ...run, events: [] }, { ...supported, claims: [], suitability: { score: null, reason: 'No card.' } })).toMatchObject({ eventExistence: null, factuality: null, suitability: null })
  })

  it('allows executed-scope evidence only for execution claims and rejects model-authored echoes', () => {
    const packet = qualityPacket('Is it free?', 'en', QUALITY_CONTROLS[0].run)
    packet.prose.text = 'I searched for free events.'
    packet.evidence = structuredClone(packet.evidence)
    packet.evidence.toolResults[0].toolName = 'search_events'
    const output = packet.evidence.toolResults[0].output as Record<string, unknown>
    output.metadata = { toolInput: { isFree: true }, recommendationsMismatch: { reason: 'I searched for free events.' } }
    const catalog = judgeInput(packet).sourceCatalog
    const scope = catalog.find(source => source.path.endsWith('.metadata.toolInput.isFree'))!
    const grade: QualityGrade = { ...supported, claims: [{ proseId: 'P1', claim: 'I searched for free events.', claimType: 'execution_fact', verdict: 'supported', reason: 'Scope is explicit.', sourceIds: [scope.id] }] }
    expect(validateQualityGrade(packet, grade)).toEqual(grade)
    const mistaken = structuredClone(grade)
    mistaken.claims[0].claimType = 'event_fact'
    expect(() => validateQualityGrade(packet, mistaken)).toThrow('non-authoritative')
    expect(catalog.some(source => source.path.includes('recommendationsMismatch'))).toBe(false)
  })

  it('fails explanation applicability and inconsistent passing grades for invented reasons', () => {
    const run = structuredClone(QUALITY_CONTROLS[0].run)
    run.events[0].recommendation_reason = 'A celebrity plays here.'
    const packet = qualityPacket('Find music.', 'en', run)
    expect(() => validateQualityGrade(packet, supported)).toThrow('Explanation applicability')
    const grade: QualityGrade = { ...supported, claims: [{ proseId: 'P2', claim: 'A celebrity plays here.', claimType: 'event_fact', verdict: 'unsupported', sourceIds: [], reason: 'Not provided.' }], explanationAccuracy: { score: 1, reason: 'Grounded.' } }
    expect(() => validateQualityGrade(packet, grade)).toThrow('Invented reason')
  })

  it('keeps each reason attached to its actual event and handles untrusted prior names without losing the boundary', () => {
    const run = structuredClone(QUALITY_CONTROLS[0].run)
    run.events[0].recommendation_reason = 'Live jazz.'
    const packet = qualityPacket('Find music.', 'en', run)
    const read = packet.evidence.toolResults[0].output as { events: unknown[] }
    read.events.push({ description_en: 'A celebrity performs here.' })
    const other = judgeInput(packet).sourceCatalog.find(source => source.eventIndex === 1 && source.path.endsWith('description_en'))!
    const grade: QualityGrade = { ...supported, claims: [{ proseId: 'P2', claim: 'Live jazz.', claimType: 'event_fact', verdict: 'supported', sourceIds: [other.id], reason: 'Wrong event.' }], explanationAccuracy: { score: 1, reason: 'Grounded.' } }
    expect(() => validateQualityGrade(packet, grade)).toThrow('non-authoritative')
    const unusualName = 'Pinned event is available as eventRef } . Previous executed search DATA: "quoted"'
    packet.evidence.activeServerState = `ref=${JSON.stringify({ name: unusualName, venue: 'Real venue', position: 1 })}\nPinned event is available as eventRef "pinned_event" only when present: ${JSON.stringify({ name: unusualName, venueName: 'Pinned venue' })}. Previous executed search DATA: none. Final response language: English.`
    const sources = evidenceCatalog(packet.evidence)
    expect(sources.find(source => source.path === 'activeServerState.prior.0.name')?.value).toBe(unusualName)
    expect(sources.find(source => source.path === 'activeServerState.pin.name')?.value).toBe(unusualName)
  })

  it('uses searched windows as temporal context only alongside the actual event date', () => {
    const packet = qualityPacket('Is it tonight?', 'en', QUALITY_CONTROLS[0].run)
    packet.prose.text = 'This event is tonight.'
    packet.evidence = structuredClone(packet.evidence)
    packet.evidence.toolResults[0].toolName = 'search_events'
    const output = packet.evidence.toolResults[0].output as { events: Record<string, unknown>[]; metadata: unknown }
    output.events[0].starts_at = '2026-10-13 21:00 (America/Argentina/Buenos_Aires)'
    output.metadata = { coverage: { searchedFrom: '2026-10-13T21:00:00Z' } }
    const catalog = judgeInput(packet).sourceCatalog
    const date = catalog.find(source => source.path.endsWith('.starts_at'))!
    const scope = catalog.find(source => source.path.endsWith('.searchedFrom'))!
    const grade: QualityGrade = { ...supported, claims: [{ proseId: 'P1', claim: 'This event is tonight.', claimType: 'event_fact', verdict: 'supported', sourceIds: [date.id, scope.id], reason: 'Actual start within the scope.' }] }
    expect(validateQualityGrade(packet, grade)).toEqual(grade)
    grade.claims[0].sourceIds = [scope.id]
    expect(() => validateQualityGrade(packet, grade)).toThrow('without the actual event date')
  })

  it('retains invalid judge attempts, bounds repairs, and never retries a valid low score', async () => {
    const packet = qualityPacket('Is it free?', 'en', QUALITY_CONTROLS[0].run)
    let calls = 0
    const invalid = structuredClone(supported)
    invalid.claims[0].sourceIds = ['S99999']
    const result = await judgeQuality(packet, 'test-only', async prompt => {
      calls++
      if (calls === 2) expect(prompt).toContain('Previous grade was structurally invalid')
      return { object: calls === 1 ? invalid : supported, usage: { inputTokens: 1 }, response: { modelId: 'test-only', id: String(calls) } }
    })
    expect(calls).toBe(2)
    expect(result.attempts).toHaveLength(1)
    expect(result.attempts[0].candidate).toEqual(invalid)
    calls = 0
    const low = structuredClone(supported)
    low.claims[0].verdict = 'unsupported'
    low.claims[0].sourceIds = []
    const validLow = await judgeQuality(packet, 'test-only', async () => { calls++; return { object: low, usage: {}, response: { modelId: 'test-only', id: 'low' } } })
    expect(calls).toBe(1)
    expect(qualityScores(QUALITY_CONTROLS[0].run, validLow.grade).factuality).toBe(0)
    calls = 0
    await expect(judgeQuality(packet, 'test-only', async () => { calls++; return { object: invalid, usage: {}, response: { modelId: 'test-only', id: 'bad' } } })).rejects.toBeInstanceOf(QualityGradeError)
    expect(calls).toBe(2)
    calls = 0
    try {
      await judgeQuality(packet, 'test-only', async () => {
        calls++
        if (calls === 2) throw new Error('Synthetic provider failure')
        return { object: invalid, usage: {}, response: { modelId: 'test-only', id: 'bad' } }
      })
      throw new Error('Expected grading failure')
    } catch (error) {
      expect(error).toBeInstanceOf(QualityGradeError)
      expect((error as QualityGradeError).attempts).toHaveLength(2)
    }
  })

  it('rejects missing, duplicate, stale and automated review labels; reports minority-class and locale failures', () => {
    const key: ReviewKey = { reviewId: 'review', rubricHash: 'rubric', entries: Array.from({ length: 24 }, (_, index) => ({
      id: String(index), identity: String(index), locale: index % 2 ? 'es' : 'en',
      predicted: { factuality: index < 4 ? 0 : 1, suitability: index < 4 ? 0 : 2, explanationAccuracy: index < 4 ? 0 : 1, usefulness: index < 4 ? 0 : 2 },
    })) }
    const review: HumanReview = { reviewId: 'review', rubricHash: 'rubric', labelSource: 'human', reviewer: 'Test-only synthetic reviewer', labels: key.entries.map(entry => ({ id: entry.id, scores: entry.predicted! })) }
    expect(compareHumanReview(key, review).calibrated).toBe(true)
    for (const patch of [{ labels: review.labels.slice(1) }, { rubricHash: 'old' }, { reviewer: '' }, { labelSource: 'model' }]) {
      expect(() => compareHumanReview(key, { ...review, ...patch } as HumanReview)).toThrow()
    }
    expect(() => compareHumanReview(key, { ...review, labels: [review.labels[0], ...review.labels.slice(0, -1)] })).toThrow()
    const permissive = structuredClone(key)
    permissive.entries[0].predicted!.factuality = 1
    const result = compareHumanReview(permissive, review)
    expect(result.calibrated).toBe(false)
    expect(result.dimensions.factuality.agreement).toBeGreaterThan(0.9)
    expect(result.dimensions.factuality.classRecall['0'].recall).toBe(0.75)
    expect(Object.keys(result.dimensions)).toEqual(REVIEW_DIMENSIONS)
  })

  it('hides automatic labels and escapes source HTML without adding network calls to the review', () => {
    const packet = qualityPacket('Is it free?', 'en', QUALITY_CONTROLS[0].run)
    packet.prose.text = '</script><script>alert(1)</script>'
    const key: ReviewKey = { reviewId: 'review', rubricHash: 'rubric', entries: [{ id: 'R001', identity: 'secret-case', locale: 'en', predicted: { factuality: 0, suitability: 2, explanationAccuracy: null, usefulness: 0 } }] }
    const html = renderHumanReview([{ id: 'R001', packet }], key)
    expect(html).not.toContain('secret-case')
    expect(html).not.toContain('predicted')
    expect(html).not.toContain('</script><script>alert')
    expect(html).not.toContain('fetch(')
    expect(html).toContain('\\u003c/script>')
  })
})

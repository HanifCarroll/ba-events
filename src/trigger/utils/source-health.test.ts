import { describe, expect, it } from 'vitest'
import { buildSourceHealthReport, SOURCE_NAMES } from './source-health.ts'

const now = new Date('2026-10-13T12:00:00.000Z')
const observedAt = '2026-10-13T10:00:00.000Z'
const result = (source: string, extra: Record<string, unknown> = {}) => ({
  source, success: true, catalogProvenance: { observedAt },
  eventsFetched: 100, eventsFiltered: 80, eventsUnchanged: 80,
  eventsInserted: 0, eventsUpdated: 0, eventsSkipped: 0, categorizationFallback: 0,
  ...extra,
})
const row = (results: unknown[], enrichment: unknown = {}, status = 'completed') => ({
  status, completed_at: '2026-10-13T11:00:00.000Z', metadata: { results, enrichment },
})

describe('source health measurements', () => {
  it('keeps zero writes healthy when a fresh catalog contains unchanged inventory', () => {
    const report = buildSourceHealthReport([row(SOURCE_NAMES.map(source => result(source)))], now)
    expect(report.needsAttention).toBe(false)
    expect(report.sources.every(source => source.state === 'healthy')).toBe(true)
    expect(report.sources[0].sourceAgeHours).toBe(2)
    expect(report.sources[0].counts).toMatchObject({ eventsFetched: 100, eventsFiltered: 80, eventsUnchanged: 80, eventsInserted: 0 })
    expect(report.enrichment).toEqual({ eligible: null, enriched: null, failed: null, remaining: null })
  })

  it('reports a failed latest source separately from its last successful observation', () => {
    const report = buildSourceHealthReport([
      row([result('Passline', { success: false, error: 'private provider diagnostic', eventsFetched: 0 })], {}, 'partial'),
      row([result('Passline')]),
    ], now)
    expect(report.sources[0]).toMatchObject({ state: 'attention', latestRunSucceeded: false, observedAt, sourceAgeHours: 2 })
    expect(report.sources[0].counts.eventsFetched).toBeNull()
    expect(report.sources[0].issues).toContain('source_failed')
    expect(report.needsAttention).toBe(true)
    expect(JSON.stringify(report)).not.toContain('private provider diagnostic')
  })

  it('flags stale and empty catalogs and observed categorization/enrichment failures', () => {
    const report = buildSourceHealthReport([row([
      result('Passline', { catalogProvenance: { observedAt: '2026-10-11T00:00:00.000Z' } }),
      result('Meetup', { eventsFetched: 0, eventsFiltered: 0 }),
      result('Luma', { categorizationFallback: 2 }),
      result('Venti', { eventsSkipped: 1 }),
    ], { eligible: 10, enriched: 7, failed: 2, remaining: 1 })], now)
    expect(report.sources[0].issues).toContain('source_stale')
    expect(report.sources[1].issues).toContain('empty_catalog')
    expect(report.sources[4].issues).toContain('categorization_fallback')
    expect(report.sources[5].issues).toContain('import_processing_skipped')
    expect(report.enrichment).toEqual({ eligible: 10, enriched: 7, failed: 2, remaining: 1 })
    expect(report.needsAttention).toBe(true)
  })

  it('keeps legacy, future and malformed observations/counts unknown', () => {
    const report = buildSourceHealthReport([row([
      { source: 'Passline', success: true, eventsFetched: -1 },
      result('Meetup', { catalogProvenance: { observedAt: '2026-10-14T10:00:00.000Z' }, eventsFiltered: 0.5 }),
      result('Eventbrite', { catalogProvenance: { observedAt: 'invalid' } }),
    ], { eligible: 10, failed: -1 })], now)
    expect(report.sources[0]).toMatchObject({ state: 'unknown', observedAt: null, sourceAgeHours: null })
    expect(report.sources[0].counts.eventsFetched).toBeNull()
    expect(report.sources[1].sourceAgeHours).toBeNull()
    expect(report.sources[1].counts.eventsFiltered).toBeNull()
    expect(report.sources[2].observedAt).toBeNull()
    expect(report.enrichment).toEqual({ eligible: 10, enriched: null, failed: null, remaining: null })
  })
})

import { Schema } from 'effect'

export const SOURCE_NAMES = ['Passline', 'Meetup', 'Eventbrite', 'BA Tourism', 'Luma', 'Venti'] as const
export const SOURCE_FRESHNESS_MS = 36 * 60 * 60 * 1000
export const SOURCE_COUNT_FIELDS = ['eventsFetched', 'eventsFiltered', 'eventsExpanded', 'eventsUnchanged', 'eventsInserted', 'eventsUpdated', 'eventsSkipped', 'categorizationSuccessful', 'categorizationFallback'] as const

const countSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const recordSchema = Schema.Struct({
  source: Schema.String,
  success: Schema.Boolean,
  catalogProvenance: Schema.optional(Schema.Unknown),
  eventsFetched: Schema.optional(Schema.Unknown), eventsFiltered: Schema.optional(Schema.Unknown),
  eventsExpanded: Schema.optional(Schema.Unknown), eventsUnchanged: Schema.optional(Schema.Unknown),
  eventsInserted: Schema.optional(Schema.Unknown), eventsUpdated: Schema.optional(Schema.Unknown),
  eventsSkipped: Schema.optional(Schema.Unknown), categorizationSuccessful: Schema.optional(Schema.Unknown),
  categorizationFallback: Schema.optional(Schema.Unknown),
})
const observationSchema = Schema.Struct({ observedAt: Schema.NullOr(Schema.String) })
const rowSchema = Schema.Struct({
  status: Schema.optional(Schema.String),
  completed_at: Schema.optional(Schema.NullOr(Schema.String)),
  metadata: Schema.optional(Schema.NullOr(Schema.Struct({
    results: Schema.optional(Schema.Array(Schema.Unknown)),
    enrichment: Schema.optional(Schema.Unknown),
  }))),
})
const enrichmentSchema = Schema.Struct({
  eligible: Schema.optional(Schema.Unknown), enriched: Schema.optional(Schema.Unknown),
  failed: Schema.optional(Schema.Unknown), remaining: Schema.optional(Schema.Unknown),
})

/** Missing, invalid and negative measurements are unknown, not zero. */
export function measuredCount(value: unknown): number | null {
  const decoded = Schema.decodeUnknownResult(countSchema)(value)
  return decoded._tag === 'Success' ? decoded.success : null
}

/** Rows are newest first. Only measured fields enter the report; raw errors/content are omitted. */
export function buildSourceHealthReport(history: readonly unknown[], now: Date = new Date()) {
  const rows = history.flatMap(row => {
    const decoded = Schema.decodeUnknownResult(rowSchema)(row)
    return decoded._tag === 'Success' ? [decoded.success] : []
  })
  const records = rows.flatMap(row => (row.metadata?.results ?? []).flatMap(value => {
    const decoded = Schema.decodeUnknownResult(recordSchema)(value)
    return decoded._tag === 'Success' ? [{ result: decoded.success, runAt: row.completed_at ?? null }] : []
  }))
  const sources = SOURCE_NAMES.map(source => {
    const latest = records.find(record => record.result.source === source)
    const successful = records.find(record => record.result.source === source && record.result.success)
    const observation = Schema.decodeUnknownResult(observationSchema)(successful?.result.catalogProvenance)
    const observedAt = observation._tag === 'Success' ? observation.success.observedAt : null
    const observedMs = observedAt === null ? NaN : Date.parse(observedAt)
    const ageMs = Number.isFinite(observedMs) && observedMs <= now.getTime() ? now.getTime() - observedMs : null
    const counts = Object.fromEntries(SOURCE_COUNT_FIELDS.map(key => [key, latest?.result.success ? measuredCount(latest.result[key]) : null]))
    const issues: string[] = []
    if (!latest) issues.push('no_source_result')
    else if (!latest.result.success) issues.push('source_failed')
    if (ageMs === null) issues.push('observation_age_unknown')
    else if (ageMs > SOURCE_FRESHNESS_MS) issues.push('source_stale')
    if (counts.eventsFetched === 0) issues.push('empty_catalog')
    if (latest?.result.success && counts.eventsFetched === null) issues.push('catalog_count_unknown')
    if ((counts.categorizationFallback ?? 0) > 0) issues.push('categorization_fallback')
    if ((counts.eventsSkipped ?? 0) > 0) issues.push('import_processing_skipped')
    const attention = issues.some(issue => ['source_failed', 'source_stale', 'empty_catalog', 'categorization_fallback', 'import_processing_skipped'].includes(issue))
    return {
      source, state: attention ? 'attention' : issues.length ? 'unknown' : 'healthy',
      latestRunAt: latest?.runAt ?? null, latestRunSucceeded: latest?.result.success ?? null,
      lastSuccessfulRunAt: successful?.runAt ?? null, observedAt: ageMs === null ? null : observedAt,
      sourceAgeHours: ageMs === null ? null : Math.round(ageMs / 36000) / 100,
      counts, issues,
    }
  })
  const decodedEnrichment = Schema.decodeUnknownResult(enrichmentSchema)(rows[0]?.metadata?.enrichment)
  const enrichment = decodedEnrichment._tag === 'Success' ? decodedEnrichment.success : {}
  const enrichmentCounts = Object.fromEntries(['eligible', 'enriched', 'failed', 'remaining'].map(key => [key, measuredCount(enrichment[key as keyof typeof enrichment])]))
  return {
    version: 'source-health-v1', checkedAt: now.toISOString(), freshnessLimitHours: SOURCE_FRESHNESS_MS / 3600000,
    latestRunStatus: rows[0]?.status ?? null,
    needsAttention: sources.some(source => source.state === 'attention') || ['failed', 'partial'].includes(rows[0]?.status ?? '') || (enrichmentCounts.failed ?? 0) > 0 || (enrichmentCounts.remaining ?? 0) > 0,
    sources, enrichment: enrichmentCounts,
  }
}

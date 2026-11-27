import type { D1Database } from '@cloudflare/workers-types'
import type { requestEventCredits } from '#shared/lib/ai/extract-facets.ts'
import { writeEvent } from '#shared/lib/db/event-write.ts'

interface CreditRow {
  id: string
  name: string
  source: string
  starts_at: string
  updated_at: string
  description_es: string | null
  description_en: string | null
  organizer_name: string | null
  performer_count: number
  enrichment_provenance: string | null
}

type ExtractCredits = (descriptions: readonly (string | null)[]) => ReturnType<typeof requestEventCredits>

export async function backfillEventCredits(db: D1Database, options: {
  from: string
  limit: number
  apply: boolean
  extract: ExtractCredits
}) {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new Error('Limit must be 1–100')
  const schema = await db.prepare('PRAGMA table_info(events)').all<{ name: string }>()
  const migrated = schema.results.some(column => column.name === 'organizer_name')
  if (options.apply && !migrated) throw new Error('Apply the event details migration before writing credits')
  const missingPeople = "((source <> 'ba-tourism' AND nullif(trim(organizer_name), '') IS NULL) OR coalesce(json_array_length(performers), 0) = 0)"
  const { results } = await db.prepare(`SELECT id, name, source, starts_at, updated_at, description_es, description_en, enrichment_provenance,
      ${migrated ? 'organizer_name, coalesce(json_array_length(performers), 0) AS performer_count' : 'NULL AS organizer_name, 0 AS performer_count'} FROM events
    WHERE status = 'scheduled' AND starts_at >= ? AND (trim(coalesce(description_es, '')) <> '' OR trim(coalesce(description_en, '')) <> '')
      AND json_extract(enrichment_provenance, '$.creditsBackfilledAt') IS NULL ${migrated ? `AND ${missingPeople}` : ''}
    ORDER BY starts_at, id LIMIT ?`).bind(options.from, options.limit).all<CreditRow>()

  const report = []
  for (const row of results) {
    const sample = { id: row.id, name: row.name, starts_at: row.starts_at, description_es: row.description_es, description_en: row.description_en }
    let credits: Awaited<ReturnType<ExtractCredits>>
    try { credits = await options.extract([row.description_es?.slice(0, 6000) ?? null, row.description_en?.slice(0, 6000) ?? null]) }
    catch { report.push({ ...sample, status: 'extraction-failed' as const }); continue }
    const organizer = row.source === 'ba-tourism' || row.organizer_name?.trim() ? undefined : credits.organizer
    const performers = row.performer_count ? undefined : credits.performers
    const result = options.apply ? await writeEvent(db, null, { writer: 'enrichment', id: row.id,
      patch: {
        organizer_name: organizer?.name, organizer_url: organizer ? organizer.url ?? null : undefined,
        performers: performers ? JSON.stringify(performers) : undefined,
        enrichment_provenance: JSON.stringify({ ...JSON.parse(row.enrichment_provenance ?? '{}'), creditsBackfilledAt: new Date().toISOString() }),
      },
      guard: { sql: `updated_at = ? AND description_es IS ? AND description_en IS ? AND enrichment_provenance IS ?
        AND status = 'scheduled' AND starts_at >= ? AND source = ? AND organizer_name IS ?
        AND coalesce(json_array_length(performers), 0) = ? AND ${missingPeople}`,
      values: [row.updated_at, row.description_es, row.description_en, row.enrichment_provenance, options.from, row.source, row.organizer_name, row.performer_count] },
    }) : null
    report.push({ ...sample, organizer, performers,
      status: !result ? 'preview' as const : result.applied.length ? 'applied' as const : 'changed-since-read' as const })
  }
  return report
}

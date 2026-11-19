/** Read-only daily scrape and inventory check. No provider calls. */
import { buildSourceHealthReport, measuredCount } from '../src/jobs-worker/source-health.ts'
import { readD1, type ReadD1 } from './read-d1.ts'

export async function sourceHealth(read: ReadD1, checkedAt = new Date()) {
  const history = await read<{ status: string; completed_at: string | null; metadata: string | null }>(
    "SELECT status, completed_at, metadata FROM scrape_runs WHERE source = 'all' ORDER BY started_at DESC LIMIT 30",
  )
  const [counts] = await read<Record<string, unknown>>(`SELECT count(*) AS scheduledUpcoming,
    count(*) FILTER (WHERE description_es IS NULL AND description_en IS NULL) AS bothDescriptionsNull,
    count(*) FILTER (WHERE description_unavailable = 1) AS descriptionUnavailable,
    count(*) FILTER (WHERE enrichment_status = 'failed') AS enrichmentFailed
    FROM events WHERE status = 'scheduled' AND starts_at >= ?`, [checkedAt.toISOString()]).catch(() => [])
  const inventory = {
    scheduledUpcoming: measuredCount(counts?.scheduledUpcoming),
    bothDescriptionsNull: measuredCount(counts?.bothDescriptionsNull),
    descriptionUnavailable: measuredCount(counts?.descriptionUnavailable),
    enrichmentFailed: measuredCount(counts?.enrichmentFailed),
  }
  const report = { ...buildSourceHealthReport(history.map(row => ({ ...row, metadata: JSON.parse(row.metadata ?? 'null') })), checkedAt), inventory }
  if ((inventory.enrichmentFailed ?? 0) > 0) report.needsAttention = true
  return report
}

if (import.meta.main) {
  try {
    const report = await sourceHealth(readD1(process.argv.includes('--staging')))
    console.log(JSON.stringify(report, null, 2))
    if (report.needsAttention || report.sources.some(source => source.state === 'unknown') || Object.values(report.inventory).some(value => value === null)) process.exitCode = 1
  } catch {
    console.error('Source health check unavailable. Check D1 read access and BA_D1_TOKEN_FILE.')
    process.exitCode = 1
  }
}

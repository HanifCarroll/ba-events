/** Read-only check of the latest 30 daily runs. No provider/model calls or database writes. */
import { createServiceRoleClient } from '../src/trigger/utils/db-client.ts'
import { buildSourceHealthReport, measuredCount } from '../src/trigger/utils/source-health.ts'

async function main() {
  const client = createServiceRoleClient()
  const { data, error } = await client.from('scrape_runs')
    .select('status, completed_at, metadata')
    .eq('source', 'all')
    .order('started_at', { ascending: false })
    .limit(30)
  if (error) throw new Error('Could not read daily scrape history')
  const checkedAt = new Date()
  const base = () => client.from('events').select('id', { count: 'exact', head: true })
    .eq('status', 'scheduled').gte('starts_at', checkedAt.toISOString())
  const inventoryReads = await Promise.all([
    base(),
    base().is('description_es', null).is('description_en', null),
    base().eq('description_unavailable', true),
    base().eq('enrichment_status', 'failed'),
  ])
  const inventory = Object.fromEntries(['scheduledUpcoming', 'bothDescriptionsNull', 'descriptionUnavailable', 'enrichmentFailed'].map((key, index) => {
    const read = inventoryReads[index]!
    return [key, read.error ? null : measuredCount(read.count)]
  }))
  const report = { ...buildSourceHealthReport(data ?? [], checkedAt), inventory }
  if ((inventory.enrichmentFailed ?? 0) > 0) report.needsAttention = true
  console.log(JSON.stringify(report, null, 2))
  if (report.needsAttention || report.sources.some(source => source.state === 'unknown') || Object.values(inventory).some(value => value === null)) process.exitCode = 1
}

main().catch(() => {
  console.error('Source health check unavailable. Check database access and service-role environment configuration.')
  process.exitCode = 1
})

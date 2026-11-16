/**
 * One-off: flag upcoming guests-only Luma events as hidden and drop their venue.
 *
 * Reads each upcoming Luma event through Luma's `/event/get` API. Where the
 * address is obfuscated (shared after registration), sets `location_hidden =
 * true` and `venue_id = null`. Public events are only reported; the daily
 * import unhides them.
 *
 *   bun scripts/backfill-luma-hidden-locations.ts           # dry run, no writes
 *   bun scripts/backfill-luma-hidden-locations.ts --apply   # write the changes
 */
import { getSupabaseServiceRoleClient } from '../src/shared/lib/db/service.server.ts'
import { fetchLumaEventDetail } from '../src/features/import/scrapers/luma/detail.ts'

interface Row { id: string; name: string; starts_at: string; link: string | null; venue_id: string | null; location_hidden: boolean | null }

async function main() {
  const apply = process.argv.includes('--apply')
  const client = getSupabaseServiceRoleClient()
  const { data, error } = await client.from('events')
    .select('id, name, starts_at, link, venue_id, location_hidden')
    .eq('source', 'luma')
    .in('status', ['scheduled', 'pending_review'])
    .gte('starts_at', new Date().toISOString())
    .order('starts_at')
    .limit(1000)
  if (error) throw new Error(`Could not read upcoming Luma events: ${error.message}`)
  const rows = (data ?? []) as Row[]

  const changes: Row[] = []
  const unreadable: string[] = []
  let alreadyHidden = 0, publicButFlagged = 0
  for (const row of rows) {
    await new Promise(resolve => setTimeout(resolve, 300)) // gentle on Luma's API
    const detail = row.link ? await fetchLumaEventDetail(row.link).catch((cause: unknown) => {
      unreadable.push(`${row.id} ${row.name}: ${cause instanceof Error ? cause.message : String(cause)}`)
      return undefined
    }) : null
    if (detail === undefined) continue
    if (!detail) { unreadable.push(`${row.id} ${row.name}: no Luma detail`); continue }
    if (!detail.location_hidden) { if (row.location_hidden) publicButFlagged++; continue }
    if (row.location_hidden && row.venue_id === null) { alreadyHidden++; continue }
    changes.push(row)
  }

  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${rows.length} upcoming Luma events read, ${changes.length} to hide, ${alreadyHidden} already hidden, ${publicButFlagged} public but flagged (left for the daily import), ${unreadable.length} unreadable`)
  for (const row of changes) {
    console.log(`- ${row.starts_at.slice(0, 10)} ${row.name} (${row.id}) location_hidden ${row.location_hidden} -> true, venue_id ${row.venue_id} -> null`)
  }
  for (const line of unreadable) console.log(`! ${line}`)
  if (!apply || changes.length === 0) return

  for (const row of changes) {
    const { error: updateError } = await client.from('events')
      .update({ location_hidden: true, venue_id: null })
      .eq('id', row.id).eq('source', 'luma')
    if (updateError) throw new Error(`Update failed for ${row.id}: ${updateError.message}`)
  }
  const { data: after, error: readError } = await client.from('events').select('id, location_hidden, venue_id').in('id', changes.map(row => row.id))
  if (readError) throw new Error(`Read-back failed: ${readError.message}`)
  const wrong = (after ?? []).filter(row => row.location_hidden !== true || row.venue_id !== null)
  console.log(`Applied ${changes.length}; read back ${after?.length ?? 0}, ${wrong.length} not hidden`)
  if (wrong.length > 0 || (after?.length ?? 0) !== changes.length) process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

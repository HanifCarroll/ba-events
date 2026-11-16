/**
 * Duplicate venues: plan the merge from production and write the SQL. Neither mode writes to the database.
 *
 *   bun scripts/venue-duplicates.ts plan   # GET-only reads → tmp/venue-duplicates/{snapshot,plan}.json and plan.md
 *   bun scripts/venue-duplicates.ts sql    # plan.json + snapshot.json → tmp/venue-duplicates/{merge.sql,undo.sql,backup.json}
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment (bun loads .env). Every request is a PostgREST
 * GET, which runs in a read-only transaction. A person reviews plan.json and runs merge.sql in one transaction; it needs
 * migration 20261116180000_venue_name_matching.sql (`venue_name_key`, `venue_merge_backup`) applied first. merge.sql
 * aborts if a planned venue's name, address or barrio changed since the plan, and saves execution-time before-images in
 * `public.venue_merge_backup`; undo.sql restores the latest merge from there.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { UNDO_SQL, mergeBackup, mergeSql, planDuplicates, planSummary, type DuplicatePlan, type VenueSnapshot } from '../src/features/import/core/venue-duplicates.ts'

const OUT = 'tmp/venue-duplicates'
const PAGE = 1000

async function getAll<T>(path: string): Promise<T[]> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE) {
    const response = await fetch(`${url}/rest/v1/${path}${path.includes('?') ? '&' : '?'}limit=${PAGE}&offset=${offset}`, {
      method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` } })
    if (!response.ok) throw new Error(`GET ${path.split('?')[0]} failed: ${response.status} ${await response.text()}`)
    const page = await response.json() as T[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

async function snapshot(): Promise<VenueSnapshot> {
  // Stable order (`id`) so offset pages neither skip nor repeat rows.
  const [venues, events, protectedRows, review_queue, dismissed, intake_candidates, intake_revisions, intake_plans] = await Promise.all([
    getAll<VenueSnapshot['venues'][number]>('venues?select=*&order=id'),
    getAll<VenueSnapshot['events'][number]>('events?select=id,venue_id,status,updated_at&venue_id=not.is.null&order=id'),
    getAll<{ event_id: string }>('event_intake_protection?select=event_id&order=event_id'),
    getAll<VenueSnapshot['review_queue'][number]>('venue_review_queue?select=*&order=id'),
    getAll<VenueSnapshot['dismissed'][number]>('dismissed_venue_duplicates?select=*&order=id'),
    getAll<VenueSnapshot['intake_candidates'][number]>('intake_candidates?select=id,venue_id:payload->>venue_id&payload->>venue_id=not.is.null&order=id'),
    getAll<VenueSnapshot['intake_revisions'][number]>('intake_candidate_revisions?select=candidate_id,revision,venue_id:payload->>venue_id&payload->>venue_id=not.is.null&order=candidate_id,revision'),
    getAll<VenueSnapshot['intake_plans'][number]>('intake_plans?select=id,venue_id:payload->>venue_id&payload->>venue_id=not.is.null&order=id'),
  ])
  return { venues, events, protected_event_ids: protectedRows.map(row => row.event_id), review_queue, dismissed,
    intake_candidates, intake_revisions, intake_plans }
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
const read = <T>(file: string) => JSON.parse(readFileSync(`${OUT}/${file}`, 'utf8')) as T

async function main() {
  const mode = process.argv[2]
  mkdirSync(OUT, { recursive: true })
  if (mode === 'plan') {
    const data = await snapshot()
    const plan = planDuplicates(data)
    writeFileSync(`${OUT}/snapshot.json`, json(data))
    writeFileSync(`${OUT}/plan.json`, json(plan))
    writeFileSync(`${OUT}/plan.md`, planSummary(plan))
    console.log(json(plan.counts))
  } else if (mode === 'sql') {
    const plan = read<DuplicatePlan>('plan.json')
    writeFileSync(`${OUT}/merge.sql`, mergeSql(plan))
    writeFileSync(`${OUT}/undo.sql`, UNDO_SQL)
    writeFileSync(`${OUT}/backup.json`, json(mergeBackup(plan, read<VenueSnapshot>('snapshot.json'))))
    console.log(`Wrote ${OUT}/merge.sql, undo.sql and backup.json for ${plan.counts.venues_merged_away} venues in ${plan.counts.merge_groups} groups`)
  } else {
    console.error('Usage: bun scripts/venue-duplicates.ts plan | sql')
    process.exit(2)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

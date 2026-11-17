/**
 * Read-only check of chat follow-up event facts (`getEventFactsByIds`, delivery PR 07b) on the staging D1 against
 * production: runs the real reader on `baeventos-staging` through a wrapper that refuses anything but SELECT, reads
 * the same ids from production with the delivery queue's GET-only `prod-read.sh`, applies the reader's projection to
 * the production rows, and compares. Prints ids and fact fields only. Exits 1 on any difference.
 *
 *   node scripts/check-event-facts-staging.ts <prod-read.sh path> <event id>...
 *
 * Run it with node (Wrangler's remote proxy hangs under Bun).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { D1Database } from '@cloudflare/workers-types'
import { getPlatformProxy } from 'wrangler'
import { useCloudflareBindings } from '../src/shared/lib/db/search-bindings.server.ts'
import { getEventFactsByIds } from '../src/shared/lib/db/client.server.ts'

const [prodRead, ...ids] = process.argv.slice(2)
if (!prodRead || ids.length === 0) throw new Error('usage: check-event-facts-staging.ts <prod-read.sh> <event id>...')
const root = join(import.meta.dirname, '..')

function selectOnly(db: D1Database): D1Database {
  const prepare = (sql: string) => {
    if (!/^\s*SELECT\b/i.test(sql)) throw new Error(`refused non-SELECT on remote staging: ${sql.trim().split(/\s+/)[0]}`)
    return db.prepare(sql)
  }
  return { prepare, batch: () => { throw new Error('refused batch on remote staging') } } as unknown as D1Database
}

const dir = mkdtempSync(join(tmpdir(), 'ba-facts-check-'))
let dispose: (() => Promise<void>) | undefined
try {
  const info = JSON.parse(execFileSync(join(root, 'node_modules/.bin/wrangler'),
    ['d1', 'info', 'baeventos-staging', '--json', '--config', 'wrangler.staging.jsonc'], { cwd: root, encoding: 'utf8' })) as { uuid: string }
  const config = join(dir, 'wrangler.json')
  writeFileSync(config, JSON.stringify({ name: 'facts-check', compatibility_date: '2026-08-25',
    account_id: /"account_id":\s*"(\w+)"/.exec(readFileSync(join(root, 'wrangler.staging.jsonc'), 'utf8'))![1],
    d1_databases: [{ binding: 'DB', database_name: 'baeventos-staging', database_id: info.uuid, remote: true }] }))
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: config, persist: false, envFiles: [] })
  dispose = proxy.dispose
  useCloudflareBindings({ DB: selectOnly(proxy.env.DB) })

  const staging = await getEventFactsByIds(ids)
  const production = (JSON.parse(execFileSync(prodRead, [
    `events_with_venues?select=id,name,venue_id,venue_name,status,location_hidden,location_tba&id=in.(${ids.join(',')})`,
  ], { encoding: 'utf8' })) as Array<Record<string, unknown>>)
    .map(({ location_hidden, location_tba, ...fact }) => ({ ...fact, venue_id: location_hidden || location_tba ? null : fact.venue_id }))

  const byId = (rows: Array<Record<string, unknown>>) => new Map(rows.map(row => [row.id as string, JSON.stringify(row, Object.keys(row).sort())]))
  const [s, p] = [byId(staging as unknown as Array<Record<string, unknown>>), byId(production)]
  let differences = 0
  for (const id of ids) {
    const same = s.get(id) === p.get(id)
    if (!same) differences++
    const fact = JSON.parse(s.get(id) ?? p.get(id) ?? '{}')
    console.log(`${same ? 'same' : 'DIFF'} ${id} status=${fact.status} venue_id=${fact.venue_id ? 'set' : 'null'} venue_name=${fact.venue_name ?? 'null'}`)
    if (!same) console.log(`  staging=${s.get(id) ?? 'missing'}\n  production=${p.get(id) ?? 'missing'}`)
  }
  console.log(`${ids.length} ids, staging ${staging.length} facts, production ${production.length}, differences ${differences}`)
  process.exitCode = differences ? 1 : 0
} finally {
  useCloudflareBindings({})
  await dispose?.()
  rmSync(dir, { recursive: true, force: true })
}

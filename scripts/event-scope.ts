import type { D1Database } from '@cloudflare/workers-types'
import { createOpenAI } from '@ai-sdk/openai'
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { getPlatformProxy, unstable_readConfig } from 'wrangler'
import { processScopeBatch, readScopePage, scopeDayStart, type ScopeReportRow, type ScopeRow } from '../src/features/events/scope/catalog.ts'
import { requestScopeJudgments, SCOPE_BATCH_SIZE, SCOPE_MODEL, SCOPE_VERSION } from '../src/features/events/scope/judge.ts'

const { values } = parseArgs({ options: {
  staging: { type: 'boolean' }, production: { type: 'boolean' },
  'dry-run': { type: 'boolean' }, apply: { type: 'boolean' }, report: { type: 'string' }, limit: { type: 'string' },
} })
if (Boolean(values.staging) === Boolean(values.production) || Boolean(values['dry-run']) === Boolean(values.apply) || !values.report) {
  throw new Error('Usage: node scripts/event-scope.ts (--staging|--production) (--dry-run|--apply) --report new-report.json [--limit 60]')
}
if (values.apply && process.env.DB_READ_ONLY === '1') throw new Error('Refusing scope writes while DB_READ_ONLY is set')
const limit = values.limit === undefined ? Infinity : Number(values.limit)
if (values.limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('--limit must be a positive integer')
const key = process.env.SCOPE_OPENAI_API_KEY
if (!key) throw new Error('Set SCOPE_OPENAI_API_KEY for the chosen environment. The CLI never loads the app .env.')

const database = values.staging ? 'baeventos-staging' : 'baeventos-production'
const config = unstable_readConfig({ config: values.staging ? 'wrangler.jobs.staging.jsonc' : 'wrangler.jobs.jsonc' })
const d1 = config.d1_databases.find((binding: { binding: string; database_name?: string }) =>
  binding.binding === 'DB' && binding.database_name === database)
if (!d1) throw new Error(`No DB binding configured for ${database}`)
const request = requestScopeJudgments(createOpenAI({ apiKey: key }).chat(SCOPE_MODEL))
const from = scopeDayStart(new Date())
const report: ScopeReportRow[] = []
let failed = 0
let applied = 0
let complete = false
let after: Pick<ScopeRow, 'starts_at' | 'id'> | undefined

// Reserve a fresh private file before classifications or writes so reruns cannot clobber a previous review.
const file = await open(values.report, 'wx', 0o600)
try {
  const dir = await mkdtemp(join(tmpdir(), 'ba-event-scope-'))
  try {
    const configPath = join(dir, 'wrangler.json')
    await writeFile(configPath, JSON.stringify({ name: 'ba-event-scope', compatibility_date: config.compatibility_date,
      account_id: config.account_id, d1_databases: [{ ...d1, remote: true }] }), { mode: 0o600 })
    const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath, persist: false, envFiles: [] })
    try {
      while (report.length < limit) {
        const rows = await readScopePage(proxy.env.DB, from, Math.min(SCOPE_BATCH_SIZE, limit - report.length), { after })
        if (!rows.length) break
        const batch = await processScopeBatch(proxy.env.DB, rows, { request, apply: values.apply === true })
        report.push(...batch.report)
        failed += batch.failed
        applied += batch.applied
        after = rows.at(-1)
      }
      complete = true
    } finally {
      await proxy.dispose()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
} finally {
  const counts = { selected: report.length, failed, applied, skipped: values.apply ? report.length - failed - applied : 0 }
  try {
    await file.writeFile(`${JSON.stringify({ database, from, version: SCOPE_VERSION, mode: values.apply ? 'apply' : 'dry-run', complete, counts, events: report }, null, 2)}\n`)
  } finally {
    await file.close()
  }
  console.log(`[event-scope] ${database} ${values.apply ? 'apply' : 'dry-run'}`, counts)
}
if (failed) process.exitCode = 1

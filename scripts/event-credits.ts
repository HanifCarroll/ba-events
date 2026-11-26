import type { D1Database } from '@cloudflare/workers-types'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { getPlatformProxy, unstable_readConfig } from 'wrangler'
import { requestEventCredits } from '../src/shared/lib/ai/extract-facets.ts'
import { DEEPSEEK_MODEL } from '../src/shared/lib/ai/constants.ts'
import { BA_TIMEZONE } from '../src/shared/lib/constants.ts'
import { backfillEventCredits } from '../src/features/import/core/event-credit-backfill.ts'

const { values } = parseArgs({ options: {
  staging: { type: 'boolean' }, production: { type: 'boolean' },
  'dry-run': { type: 'boolean' }, apply: { type: 'boolean' }, report: { type: 'string' }, limit: { type: 'string', default: '10' },
} })
if (Boolean(values.staging) === Boolean(values.production) || (values.apply && values['dry-run']) || !values.report) {
  throw new Error('Usage: node scripts/event-credits.ts (--staging|--production) [--dry-run|--apply] --report new-report.json [--limit 10]')
}
if (values.apply && process.env.DB_READ_ONLY === '1') throw new Error('Refusing credits writes while DB_READ_ONLY is set')
const limit = Number(values.limit)
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be 1–100')
const key = process.env.EVENT_CREDITS_DEEPSEEK_API_KEY
if (!key) throw new Error('Set EVENT_CREDITS_DEEPSEEK_API_KEY for the chosen environment. The CLI does not load the app .env.')

const database = values.staging ? 'baeventos-staging' : 'baeventos-production'
const config = unstable_readConfig({ config: values.staging ? 'wrangler.jobs.staging.jsonc' : 'wrangler.jobs.jsonc' })
const d1 = config.d1_databases.find((binding: { binding: string; database_name?: string }) => binding.binding === 'DB' && binding.database_name === database)
if (!d1) throw new Error(`No DB binding configured for ${database}`)
const model = createDeepSeek({ apiKey: key })(DEEPSEEK_MODEL)
const from = `${new Date().toLocaleDateString('en-CA', { timeZone: BA_TIMEZONE })}T03:00:00.000Z`
const apply = values.apply === true

// Source descriptions and sample results belong in a fresh private file, not the logs.
const file = await open(values.report, 'wx', 0o600)
try {
  const dir = await mkdtemp(join(tmpdir(), 'ba-event-credits-'))
  try {
    const configPath = join(dir, 'wrangler.json')
    await writeFile(configPath, JSON.stringify({ name: 'ba-event-credits', compatibility_date: config.compatibility_date,
      account_id: config.account_id, d1_databases: [{ ...d1, remote: true }] }), { mode: 0o600 })
    const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath, persist: false, envFiles: [] })
    try {
      const events = await backfillEventCredits(proxy.env.DB, { from, limit, apply, extract: descriptions => requestEventCredits(descriptions, model) })
      const counts = { selected: events.length, applied: events.filter(e => e.status === 'applied').length,
        failed: events.filter(e => e.status === 'extraction-failed').length }
      await file.writeFile(`${JSON.stringify({ database, from, model: DEEPSEEK_MODEL, mode: apply ? 'apply' : 'dry-run', counts, events }, null, 2)}\n`)
      console.log(`[event-credits] ${database} ${apply ? 'apply' : 'dry-run'}`, counts)
      if (counts.failed) process.exitCode = 1
    } finally { await proxy.dispose() }
  } finally { await rm(dir, { recursive: true, force: true }) }
} finally { await file.close() }

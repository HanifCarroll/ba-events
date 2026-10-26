/** Operator boundary. All publishing goes through revision-checked intake plans. */
import { Effect, Schema } from 'effect'
import { createClient } from '@supabase/supabase-js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { collectInstagramEffect, type ApifyRequest } from '../src/features/import/intake/collection.ts'
import { SourceSchema } from '../src/features/import/intake/schema.ts'
import { submitCandidateEffect, previewCandidateEffect, commitPlanEffect } from '../src/features/import/intake/service.ts'
import { allRowsEffect, dbEffect } from '../src/features/import/intake/repository.ts'

const HELP = `Instagram event intake
  preflight                    Read configuration readiness; no paid or catalog writes
  sources                      List the qualified watchlist
  source <file.json>            Store a qualified source (new discoveries should be disabled)
  collect                      Start or resume today's capped Apify collection
  pending                      List unreviewed observations and media metadata
  export                       Save pending evidence privately for Codex image inspection
  candidates                   List saved candidate revisions
  lookup <name>                Find venues and catalog events by name
  submit <file.json>            Validate and save a structured candidate revision
  preview <candidate-uuid>      Save a proposed create/update/link/held plan
  commit <plan-uuid>            Publish the prepared plan and return its durable receipt
  review <file.json>            Record a completed post review with its disposition

Read docs/instagram-intake.md before operating. No schema, deployment or budget-changing commands are exposed.`

function client() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Server database configuration is missing')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
// CLI authentication stays in the existing Apify keychain. No token is put on the command line.
const apify: ApifyRequest = async (method, path, params, body) => {
  const args = [process.env.APIFY_CLI_PATH ?? 'apify', 'api', method, path]
  if (params) args.push('-p', JSON.stringify(params))
  if (body) args.push('-d', '-')
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(args[0], args.slice(1), { env: { ...process.env, APIFY_CLI_DISABLE_TELEMETRY: '1' },
      timeout: 55000, maxBuffer: 50 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(new Error(`Apify ${method} request failed; check CLI login and run history without displaying credentials`))
      else resolve(stdout)
    })
    child.stdin?.end(body ? JSON.stringify(body) : undefined)
  })
  return JSON.parse(stdout)
}

export async function main(args: string[]) {
  const [command, input] = args
  if (!command || command === '--help') { console.log(HELP); return }
  const db = client()
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
  let result: unknown
  switch (command) {
    case 'preflight': {
      const policy = await run(dbEffect('intake.policy', () => db.from('intake_policy').select('*').single()))
      const sources = await run(dbEffect('intake.sources', () => db.from('instagram_sources').select('username').eq('enabled', true)))
      const buckets = await run(dbEffect('intake.buckets', () => db.storage.listBuckets()))
      const storage = buckets.some(bucket => bucket.id === 'instagram-evidence' && !bucket.public) && buckets.some(bucket => bucket.id === 'event-artwork' && bucket.public)
      result = { schema_ready: true, storage_ready: storage, active_sources: sources.length,
        collection_enabled: policy.collection_enabled, publishing_enabled: policy.publishing_enabled,
        run_cap_usd: Number(policy.run_cap_usd), monthly_cap_usd: Number(policy.monthly_cap_usd),
        embedding_key_present: !!process.env.OPENAI_API_KEY, presentation_key_present: !!process.env.DEEPSEEK_API_KEY,
        publishing_ready: storage && policy.publishing_enabled && !!process.env.OPENAI_API_KEY && !!process.env.DEEPSEEK_API_KEY,
        collection_ready: storage && policy.collection_enabled && sources.length > 0 && sources.length <= policy.max_sources }
      break
    }
    case 'sources': result = await run(allRowsEffect(db, 'instagram_sources', '*', query => query.order('username'))); break
    case 'source': {
      const source = Schema.decodeUnknownSync(SourceSchema, { onExcessProperty: 'error' })(JSON.parse(await readFile(input, 'utf8')))
      result = await run(dbEffect('intake.source', () => db.from('instagram_sources').upsert(source).select().single())); break
    }
    case 'collect': result = await run(collectInstagramEffect(db, apify)); break
    case 'pending':
    case 'export': {
      const observations = await run(allRowsEffect(db, 'intake_observations', '*', query => query.is('reviewed_at', null).order('observed_at')))
      const records = []
      const folder = resolve(process.env.INTAKE_WORK_DIR ?? join(homedir(), 'Library/Application Support/BA Events/Instagram Intake'))
      if (command === 'export' && (folder === process.cwd() || folder.startsWith(process.cwd() + '/'))) throw new Error('Evidence must be saved outside the repository')
      if (command === 'export') await mkdir(folder, { recursive: true, mode: 0o700 })
      for (const observation of observations) {
        const media = await run(dbEffect('intake.media', () => db.from('intake_media').select('*').eq('observation_id', observation.id).order('position')))
        const localMedia = []
        for (const image of media) {
          if (command === 'export') {
            if (!/^[0-9a-f]{64}\.(jpg|png|webp)$/.test(image.object_key)) throw new Error('Invalid retained media key')
            const blob = await run(dbEffect('intake.download', () => db.storage.from('instagram-evidence').download(image.object_key)))
            const path = join(folder, image.object_key)
            await writeFile(path, new Uint8Array(await blob.arrayBuffer()), { mode: 0o600 })
            localMedia.push({ ...image, path })
          } else localMedia.push(image)
        }
        records.push({ ...observation, media: localMedia })
      }
      if (command === 'export') {
        const path = join(folder, 'pending.json')
        await writeFile(path, JSON.stringify(records, null, 2) + '\n', { mode: 0o600 })
        result = { path, observations: records.length }
      } else result = records
      break
    }
    case 'candidates': result = await run(allRowsEffect(db, 'intake_candidates', '*', query => query.order('updated_at'))); break
    case 'lookup': {
      if (!input || input.length > 100 || /[%_,()]/.test(input)) throw new Error('Use a plain name fragment')
      const venues = await run(dbEffect('intake.venues', () => db.from('venues').select('id,name,address,neighborhood').ilike('name', `%${input}%`).limit(30)))
      const events = await run(dbEffect('intake.events', () => db.from('events').select('id,name,starts_at,venue_id,price,is_free,status,source,ticket_url,link,updated_at').ilike('name', `%${input}%`).order('starts_at', { ascending: false }).limit(100)))
      result = { venues, events, coverage: 'bounded name lookup; preview performs the complete date-window comparison' }; break
    }
    case 'submit': result = await run(submitCandidateEffect(db, JSON.parse(await readFile(input, 'utf8')))); break
    case 'preview': result = await run(previewCandidateEffect(db, input, process.env.SUPABASE_URL!)); break
    case 'commit': {
      const { previous_event: _privateSnapshot, ...receipt } = await run(commitPlanEffect(db, input))
      result = receipt; break
    }
    case 'review': {
      const review = Schema.decodeUnknownSync(Schema.Struct({ observation_id: Schema.String,
        note: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(4000))) }), { onExcessProperty: 'error' })(JSON.parse(await readFile(input, 'utf8')))
      result = await run(dbEffect('intake.review', () => db.from('intake_observations').update({ reviewed_at: new Date().toISOString(), review_note: review.note }).eq('id', review.observation_id).select('id,reviewed_at').single())); break
    }
    default: throw new Error('Unknown command. Use --help')
  }
  console.log(JSON.stringify(result, null, 2))
}

if (import.meta.main) main(process.argv.slice(2)).catch(error => {
  const message = error instanceof Error ? error.message : 'Intake failed'
  console.error(message.replace(/apify_api_[\w-]+|sb_secret_[\w-]+|sk-[\w-]+/g, '[REDACTED]'))
  process.exitCode = 1
})

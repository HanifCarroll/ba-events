/** Operator boundary. All publishing goes through revision-checked intake plans. */
import { Effect } from 'effect'
import { createClient } from '@supabase/supabase-js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { collectInstagramEffect, type ApifyRequest } from '../src/features/import/intake/collection.ts'
import { intakeApi, remoteCollection, type IntakeApi } from '../src/features/import/intake/client.ts'
import { decodeReview, decodeSource, lookupEffect, pendingEffect, preflightEffect, publicReceipt } from '../src/features/import/intake/operations.ts'
import { submitCandidateEffect, previewCandidateEffect, commitPlanEffect } from '../src/features/import/intake/service.ts'
import { supabaseIntake } from '../src/features/import/intake/store-supabase.ts'
import { decodeVenueRequest, heldBacklogEffect, resolveIntakeVenueEffect } from '../src/features/import/intake/venues.ts'
const HELP = `Instagram event intake
  preflight                    Read configuration readiness; no paid or catalog writes
  sources                      List the qualified watchlist
  source <file.json>            Store a qualified source (new discoveries should be disabled)
  collect                      Start or resume today's capped Apify collection
  pending                      List unreviewed observations and media metadata
  export                       Save pending evidence privately for Codex image inspection
  candidates                   List saved candidate revisions
  held                         List future unpublished candidates grouped by venue, with hold reasons
  lookup <name>                Find venues and catalog events by name
  venue <file.json>             Find or create a Buenos Aires venue from sourced name, address and evidence
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

/** The intake API when both are set (D1, after the cutover); otherwise Supabase with the service key, as before. */
function api(): IntakeApi | null {
  const url = process.env.INTAKE_API_URL, token = process.env.INTAKE_API_TOKEN
  if (!url && !token) return null
  if (!url || !token) throw new Error('Set both INTAKE_API_URL and INTAKE_API_TOKEN, or neither')
  return intakeApi(url, token)
}
const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as unknown
const workFolder = () => resolve(process.env.INTAKE_WORK_DIR ?? join(homedir(), 'Library/Application Support/BA Events/Instagram Intake'))

/** Writes pending evidence privately for image inspection; `download` reads one retained image by key. */
async function exportPending(records: Array<Record<string, unknown> & { media: Array<Record<string, unknown>> }>, download: (key: string) => Promise<Uint8Array>) {
  const folder = workFolder()
  if (folder === process.cwd() || folder.startsWith(process.cwd() + '/')) throw new Error('Evidence must be saved outside the repository')
  await mkdir(folder, { recursive: true, mode: 0o700 })
  const saved = []
  for (const record of records) {
    const media = []
    for (const image of record.media) {
      const key = image.object_key as string
      if (!/^[0-9a-f]{64}\.(jpg|png|webp)$/.test(key)) throw new Error('Invalid retained media key')
      const path = join(folder, key)
      await writeFile(path, await download(key), { mode: 0o600 })
      media.push({ ...image, path })
    }
    saved.push({ ...record, media })
  }
  const path = join(folder, 'pending.json')
  await writeFile(path, JSON.stringify(saved, null, 2) + '\n', { mode: 0o600 })
  return { path, observations: saved.length }
}

/** API mode: the same commands and output, through `/intake/*` on baeventos-jobs. Inputs are decoded again server-side. */
async function viaApi(remote: IntakeApi, command: string, input: string | undefined): Promise<unknown> {
  switch (command) {
    case 'preflight': case 'candidates': case 'held': case 'pending': return remote.call(command)
    case 'sources': return remote.call('sources/list')
    case 'source': return remote.call('source', await Effect.runPromise(decodeSource(await readJson(input!))))
    case 'collect': return Effect.runPromise(collectInstagramEffect(remoteCollection(remote), apify))
    case 'export': return exportPending(await remote.call('pending'), key => remote.getMedia(key))
    case 'venue': {
      let request
      try { request = decodeVenueRequest(await readJson(input!)) }
      catch (error) { throw new Error(`Invalid venue request: ${error instanceof Error ? error.message : 'see docs/instagram-intake.md'}`) }
      return remote.call('venue', request)
    }
    case 'lookup': return remote.call('lookup', { name: input ?? '' })
    case 'submit': return remote.call('submit', await readJson(input!))
    case 'preview': return remote.call('preview', { id: input })
    case 'commit': return remote.call('commit', { id: input })
    case 'review': return remote.call('review', await Effect.runPromise(decodeReview(await readJson(input!))))
    default: throw new Error('Unknown command. Use --help')
  }
}

export async function main(args: string[]) {
  const [command, input] = args
  if (!command || command === '--help') { console.log(HELP); return }
  const remote = api()
  if (remote) { console.log(JSON.stringify(await viaApi(remote, command, input), null, 2)); return }
  const db = client()
  const store = supabaseIntake(db, process.env.SUPABASE_URL!)
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
  let result: unknown
  switch (command) {
    case 'preflight': result = await run(preflightEffect(store, { embedding: !!process.env.OPENAI_API_KEY, presentation: !!process.env.DEEPSEEK_API_KEY })); break
    case 'sources': result = await run(store.sources()); break
    case 'source': result = await run(decodeSource(await readJson(input)).pipe(Effect.flatMap(source => store.upsertSource(source)))); break
    case 'collect': result = await run(collectInstagramEffect(store, apify)); break
    case 'pending': result = await run(pendingEffect(store)); break
    case 'export': result = await exportPending(await run(pendingEffect(store)), key => run(store.evidenceBytes(key))); break
    case 'candidates': result = await run(store.candidates()); break
    case 'held': result = await run(heldBacklogEffect(store)); break
    case 'venue': {
      let request
      try { request = decodeVenueRequest(await readJson(input)) }
      catch (error) { throw new Error(`Invalid venue request: ${error instanceof Error ? error.message : 'see docs/instagram-intake.md'}`) }
      result = await run(resolveIntakeVenueEffect(store, request)); break
    }
    case 'lookup': result = await run(lookupEffect(store, input)); break
    case 'submit': result = await run(submitCandidateEffect(store, await readJson(input))); break
    case 'preview': result = await run(previewCandidateEffect(store, input)); break
    case 'commit': result = publicReceipt(await run(commitPlanEffect(store, input))); break
    case 'review': result = await run(decodeReview(await readJson(input)).pipe(Effect.flatMap(review => store.reviewObservation(review.observation_id, review.note)))); break
    default: throw new Error('Unknown command. Use --help')
  }
  console.log(JSON.stringify(result, null, 2))
}

if (import.meta.main) main(process.argv.slice(2)).catch(error => {
  const message = error instanceof Error ? error.message : 'Intake failed'
  console.error(message.replace(/apify_api_[\w-]+|sb_secret_[\w-]+|sk-[\w-]+/g, '[REDACTED]'))
  process.exitCode = 1
})

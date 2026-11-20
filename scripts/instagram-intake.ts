/** Operator boundary. All publishing goes through revision-checked intake plans. */
import { Effect } from 'effect'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { collectInstagramEffect, type ApifyRequest } from '../src/features/import/intake/collection.ts'
import { intakeApi, remoteCollection, type IntakeApi } from '../src/features/import/intake/client.ts'
import { decodeReview, decodeSource } from '../src/features/import/intake/operations.ts'
import { decodeVenueRequest } from '../src/features/import/intake/venues.ts'
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

const APIFY_CLI = ['bunx', '--package', 'apify-cli@1.10.0', 'apify']
type CliResult = { ok: true; stdout: string } | { ok: false; stderr: string }

// CLI authentication stays in the existing Apify login. No token or Actor input is put on the command line.
function runApify([command, ...args]: string[], body?: string): Promise<CliResult> {
  return new Promise(resolve => {
    const child = execFile(command, args, { env: { ...process.env, APIFY_CLI_DISABLE_TELEMETRY: '1' },
      timeout: 55000, maxBuffer: 50 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve(error ? { ok: false, stderr } : { ok: true, stdout })
    })
    child.stdin?.on('error', () => {}) // execFile reports the result if the child exits without reading stdin.
    child.stdin?.end(body)
  })
}

export function apifyRequest(cli = process.env.APIFY_CLI_PATH, run = runApify): ApifyRequest {
  let command = cli ? [cli] : APIFY_CLI
  return async (method, path, params, body) => {
    const args = ['api', method, path]
    if (params) args.push('-p', JSON.stringify(params))
    if (body) args.push('-d', '-')
    let result = await run([...command, ...args], body ? JSON.stringify(body) : undefined)
    // Bare `bunx apify-cli@…` wrappers can select the package's Actor runtime binary instead of `apify`.
    // Collection checks limits or reads run status before any POST; never replay an Actor start.
    if (method === 'GET' && command !== APIFY_CLI && !result.ok && /^Error: Command api not found\s*$/m.test(result.stderr)) {
      command = APIFY_CLI
      result = await run([...command, ...args])
    }
    const failure = () => new Error(`Apify ${method} request failed; check CLI login and run history without displaying credentials`)
    if (!result.ok) throw failure()
    try { return JSON.parse(result.stdout) } catch { throw failure() }
  }
}

function api(): IntakeApi {
  const url = process.env.INTAKE_API_URL, token = process.env.INTAKE_API_TOKEN
  if (!url || !token) throw new Error('Set both INTAKE_API_URL and INTAKE_API_TOKEN')
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
    case 'collect': return Effect.runPromise(collectInstagramEffect(remoteCollection(remote), apifyRequest()))
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
  console.log(JSON.stringify(await viaApi(api(), command, input), null, 2))
}

if (import.meta.main) main(process.argv.slice(2)).catch(error => {
  const message = error instanceof Error ? error.message : 'Intake failed'
  console.error(message.replace(/apify_api_[\w-]+|sb_secret_[\w-]+|sk-[\w-]+/g, '[REDACTED]'))
  process.exitCode = 1
})

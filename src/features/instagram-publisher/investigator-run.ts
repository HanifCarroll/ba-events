import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { applyCatalogFix, catalogRowSql, eventId, fixInput, line, StaleCatalogFix, type CatalogQuery, type FixInput, type FixReceipt } from './catalog-fix.ts'
import { parseDraftId } from './formats.ts'
import { finding, hasCompleted, location, readJson, unitName, type InvestigationRequest } from './investigation.ts'
import type { Draft } from './job.ts'
import * as runtime from './runtime.ts'

const scripts = join(runtime.REPO, 'scripts/publisher-investigator')
const entry = join(runtime.REPO, 'scripts/instagram-publisher.ts')
const node = [process.execPath, '--experimental-transform-types', entry]
const paths = (dir: string) => ({ request: join(dir, 'request.json'), log: join(dir, 'fixes.jsonl') })

export async function startInvestigator(request: InvestigationRequest, dir: string, runner = runtime.run) {
  const remaining = Math.floor((request.endsAt - Date.now()) / 1000)
  if (remaining < 1) throw new Error('No investigation time remains.')
  const path = [join(homedir(), '.local/bin'), join(homedir(), '.local/share/mise/shims'), process.env.PATH ?? '/usr/bin:/bin'].join(':')
  const argv = ['systemd-run', '--user', '--collect', '--quiet', `--unit=${unitName(request)}`, `--working-directory=${dir}`,
    '-p', 'Type=exec', '-p', 'MemoryMax=1000M', '-p', 'MemorySwapMax=0', '-p', 'KillMode=control-group', '-p', 'TimeoutStopSec=2s',
    '-p', `RuntimeMaxSec=${remaining}`, `--setenv=PATH=${path}`, `--setenv=BA_INSTAGRAM_STATE_DIR=${runtime.STATE_DIR}`]
  for (const key of ['BA_D1_TOKEN_FILE', 'BA_INSTAGRAM_CATALOG_FIX_TOKEN_FILE', 'BA_INSTAGRAM_FFMPEG_DIR', 'BA_PUBLISHER_PI', 'DB_READ_ONLY']) {
    if (process.env[key]) argv.push(`--setenv=${key}=${process.env[key]}`)
  }
  const result = await runner([...argv, ...node, 'investigator-run', dir], 4_000)
  if (result.code !== 0) throw new Error('Could not start the investigator user service.')
}

export async function investigatorRunning(request: InvestigationRequest) {
  return (await runtime.run(['systemctl', '--user', 'is-active', '--quiet', `${unitName(request)}.service`], 3_000)).code === 0
}

export async function stopInvestigator(request: InvestigationRequest) {
  // The stop marker refuses further writes. Let a submitted D1 request record its acknowledgement if one is still in flight.
  if (existsSync(join(location(runtime.STATE_DIR, request), 'catalog-fix.lock'))) return
  await runtime.run(['systemctl', '--user', 'stop', '--no-block', `${unitName(request)}.service`], 3_000)
}

function active(dir: string) {
  const request = readJson(paths(dir).request) as InvestigationRequest | null
  if (!request || !Number.isSafeInteger(request.revision)) throw new Error('No active investigation request.')
  parseDraftId(request.id)
  if (dir !== location(runtime.STATE_DIR, request) || hasCompleted(dir) || existsSync(join(dir, 'stopped')) || Date.now() >= request.endsAt) {
    throw new Error('The investigation has ended.')
  }
  const draft = readJson(join(runtime.STATE_DIR, 'drafts', `${request.id}.json`)) as Draft | null
  const saved = draft?.review?.investigation
  if (!draft || draft.state !== 'previewed' || draft.revision !== request.revision || draft.framesHash !== request.framesHash ||
      draft.publish || draft.storyShare || draft.approvedSeenAt || saved?.findings || saved?.request.startsAt !== request.startsAt ||
      saved.request.copyHash !== request.copyHash) throw new Error('The investigation no longer owns this preview.')
  return request
}

/** One record before the D1 batch, one after acknowledgement. An unknown outcome never triggers a blind retry. */
export function fixLog(dir: string) {
  const file = paths(dir).log
  const records: Array<{ state: 'submitted' | 'applied' | 'refused'; receipt: FixReceipt }> = existsSync(file)
    ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
  const applied = records.filter(item => item.state === 'applied').map(item => item.receipt)
  const uncertain = records.some(item => item.state === 'submitted' && !records.some(other => other.state !== 'submitted' && other.receipt.operation === item.receipt.operation))
  return { applied, uncertain }
}

async function withProductionD1<T>(use: (query: CatalogQuery) => Promise<T>) {
  if (process.env.DB_READ_ONLY === '1') throw new Error('Catalog corrections are disabled by DB_READ_ONLY.')
  const tokenFile = process.env.BA_INSTAGRAM_CATALOG_FIX_TOKEN_FILE ?? join(homedir(), '.config/ba-events/instagram-catalog-fix-token')
  if (!existsSync(tokenFile) || (statSync(tokenFile).mode & 0o777) !== 0o600) throw new Error('Set up the publisher D1 Write token file with mode 600.')
  const token = readFileSync(tokenFile, 'utf8').trim()
  if (!/^\S+$/u.test(token)) throw new Error('Invalid publisher D1 Write token file.')
  const { unstable_readConfig } = await import('wrangler')
  const source = unstable_readConfig({ config: join(runtime.REPO, 'wrangler.jobs.jsonc') })
  const binding = source.d1_databases.find((item: { binding: string; database_name?: string }) => item.binding === 'DB' && item.database_name === 'baeventos-production')
  if (!binding || !source.account_id) throw new Error('Production catalog binding is not configured.')
  return use(async (sql, params) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${source.account_id}/d1/database/${binding.database_id}/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(30_000), body: JSON.stringify({ sql, params }),
    })
    const data = await response.json()
    if (!response.ok || data.success !== true || data.result?.length !== 1 || data.result[0].success !== true || !Array.isArray(data.result[0].results)) {
      throw new Error('D1 did not acknowledge the operation.')
    }
    return data.result[0].results
  })
}

export async function catalogFix(dir: string, input: FixInput, use = withProductionD1) {
  input = fixInput.parse(input)
  const request = active(dir)
  if (!request.events.some(event => event.id === input.id)) throw new Error('Only flagged events can be corrected.')
  const lock = join(dir, 'catalog-fix.lock')
  mkdirSync(lock, { mode: 0o700 })
  try {
    const { applied, uncertain } = fixLog(dir)
    if (uncertain || applied.length >= 12) throw new Error('The investigation has an unconfirmed correction or reached its fix limit.')
    let receipt: FixReceipt | undefined
    const append = (state: string) => appendFileSync(paths(dir).log, `${JSON.stringify({ state, receipt })}\n`, { mode: 0o600 })
    try {
      return await use(async query => {
        await applyCatalogFix(query, input, changes => {
          active(dir)
          receipt = { ...input, operation: randomUUID(), at: new Date().toISOString(), changes }
          append('submitted')
          return receipt.operation
        })
        append('applied')
        return receipt!
      })
    } catch (error) {
      // Don't let a provider exception leak headers or credential-bearing configuration into a model session.
      if (receipt && error instanceof StaleCatalogFix) { append('refused'); throw error }
      if (receipt) throw new Error('The D1 correction was submitted. Check the fix log before retrying.')
      if (error instanceof Error && /^(Catalog correction refused|Correct only |The corrected start |A free event |Invalid catalog correction|Use a UTC |Price must |is_free must )/u.test(error.message)) throw error
      throw new Error('Could not prepare the correction. Hermes should check the D1 Write token and binding.')
    }
  } finally { rmSync(lock, { recursive: true, force: true }) }
}

export async function runInvestigator(dir: string) {
  const request = active(dir)
  const { input } = request
  if (runtime.fileHash(input.frames) !== request.framesHash) throw new Error('The reported frames changed before investigation.')
  const ids = request.events.map(({ id }) => eventId.parse(id))
  const sources = await runtime.reviewSources(ids)
  const frames = await runtime.reviewStills(input, dir)
  if (runtime.fileHash(input.frames) !== request.framesHash) throw new Error('The reported frames changed before investigation.')
  const events = []
  for (const item of request.events) {
    const { flyer, ...source } = sources.get(item.id) ?? {}
    events.push({ ...item, source, flyer, card: input.events.findIndex(event => event.id === item.id) + 1,
      rendered: input.events.find(event => event.id === item.id), catalog: await runtime.d1Read(catalogRowSql(item.id)) })
  }
  runtime.writeJson(join(dir, 'evidence.json'), { id: request.id, format: input.format, from: input.from, to: input.to,
    slot: request.slot, cutoff: request.cutoff, stopBy: new Date(request.endsAt).toISOString(), caption: input.caption, threads: input.threads, events, frames })
  active(dir)
  const sessions = join(runtime.STATE_DIR, 'investigator-sessions')
  mkdirSync(sessions, { recursive: true, mode: 0o700 })
  const fd = openSync(join(dir, 'run.log'), 'a', 0o600)
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.env.BA_PUBLISHER_PI ?? 'pi', ['-p', '--no-approve', '--no-extensions', '--no-mcp', '--no-context-files',
        '--no-skills', '--no-prompt-templates', '--model', 'openai/gpt-6.2-sol', '--thinking', 'high', '--session-dir', sessions,
        '--exclude-tools', 'ask_user_question,herdr_*,computer_use_*,mcp__*,*schedule*', '--tools', 'publisher_investigation',
        '--extension', join(scripts, 'tools.mjs'), '--system-prompt', join(scripts, 'prompt.md'), 'Investigate the flagged BA Eventos events.'], {
        cwd: dir, stdio: ['ignore', fd, fd], env: { ...process.env, BA_INVESTIGATION_DIR: dir, BA_INVESTIGATION_ENTRY: entry, BA_INVESTIGATION_NODE: process.execPath },
      })
      child.on('error', reject)
      child.on('close', resolve)
    })
    if (code !== 0) throw new Error(`Pi investigator exited with ${code ?? 'a signal'}.`)
    active(dir)
    runtime.writeJson(join(dir, 'completed.json'), { at: Date.now() })
  } finally { closeSync(fd) }
}

/** Trusted dispatcher behind the run's single allowlisted Pi tool. No arbitrary file paths, shell, or raw SQL. */
export async function investigatorTool(dir: string, action: string, raw: string) {
  const request = active(dir)
  const { id, input } = request
  const data: unknown = JSON.parse(raw)
  const memory = join(runtime.STATE_DIR, 'investigator-memory.md')
  if (action === 'remember') { appendFileSync(memory, `${line(500).parse(data)}\n`, { mode: 0o600 }); return null }
  if (action === 'research' || action === 'search') {
    const { researchPage, researchSearch } = await import('./investigator-web.ts')
    return action === 'research' ? researchPage(line(1500).parse(data)) : researchSearch(line(180).parse(data))
  }
  if (action === 'overview') {
    const { frames: _frames, events, ...overview } = readJson(join(dir, 'evidence.json')) as {
      frames: string[]; events: Array<Record<string, unknown>>; id: string
    }
    return { ...overview, events: events.map(({ flyer: _flyer, ...event }) => event),
      memory: existsSync(memory) ? readFileSync(memory, 'utf8').slice(-4000) : '' }
  }
  if (action === 'finish') {
    if (!Array.isArray(data) || data.length !== 2) throw new Error('Pass [event ID, finding].')
    const [uuid, result] = data as unknown[]
    const target = eventId.parse(uuid)
    if (!request.events.some(event => event.id === target)) throw new Error('Not a flagged event.')
    runtime.writeJson(join(dir, `${target}.result.json`), { at: Date.now(), finding: finding.parse(result) })
    return 'Finding saved.'
  }
  if (action === 'image' && (data === 'cover' || data === 'closing')) {
    const { frames } = readJson(join(dir, 'evidence.json')) as { frames: string[] }
    return { jpeg: readFileSync(data === 'cover' ? frames[0]! : frames.at(-1)!).toString('base64') }
  }
  const target = eventId.parse(data)
  if (!request.events.some(event => event.id === target)) throw new Error(`Not a flagged event in ${id}.`)
  if (action === 'catalog' || action === 'occurrences') return runtime.d1Read(catalogRowSql(target, action === 'occurrences'))
  const { frames, events } = readJson(join(dir, 'evidence.json')) as { frames: string[]; events: Array<{ id: string; flyer?: string }> }
  if (action === 'flyer') return { jpeg: events.find(event => event.id === target)?.flyer?.split(',')[1] ?? null }
  if (action === 'image') return { jpeg: readFileSync(frames[input.events.findIndex(event => event.id === target) + 1]!).toString('base64') }
  throw new Error('Unknown investigation operation.')
}

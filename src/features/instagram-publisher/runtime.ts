/**
 * The VPS side: config, state files, the read-only D1 query, Slack, R2, the Instagram token, alerts, and rendering.
 * Nothing here writes D1. Secrets are read from files and never printed.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { addDays } from './format.ts'
import type { FormatKey, RunWindow } from './formats.ts'
import type { CatalogEvent } from './select.ts'

const HOME = homedir()
export const REPO = resolve(dirname(new URL(import.meta.url).pathname), '../../..')
export const STATE_DIR = process.env.BA_INSTAGRAM_STATE_DIR ?? join(HOME, '.local/state/ba-events-instagram')
export const CONFIG_FILE = process.env.BA_INSTAGRAM_CONFIG ?? join(HOME, '.config/ba-events/instagram-publisher.json')
export const TOKEN_FILE = process.env.BA_INSTAGRAM_TOKEN_FILE ?? join(HOME, '.config/ba-events/instagram-token.json')
const CF_TOKEN_FILE = process.env.BA_D1_TOKEN_FILE ?? join(HOME, '.config/ba-events/cloudflare-deploy-token')
const CF_ACCOUNT = '38d9d25d890a220fb7cf6dd92f8a322a'
const SLACK_API = process.env.BA_INSTAGRAM_SLACK_API ?? join(HOME, '.hermes/skills/productivity/slack-workspace/scripts/slack_api.py')
const ALERT = process.env.BA_INSTAGRAM_ALERT ?? join(HOME, '.local/bin/alert')
export const SLACK_CHANNEL = 'C0CHBCSEV3R'

export const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms))

/** Run a command with a time limit; resolves with its output and exit code (null when killed). */
export function run(argv: string[], timeoutMs: number, cwd?: string): Promise<{ out: string; err: string; code: number | null }> {
  return new Promise((done, fail) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { err += chunk })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('error', error => { clearTimeout(timer); fail(error) })
    child.on('close', code => { clearTimeout(timer); done({ out, err, code }) })
  })
}

export function log(message: string) {
  console.log(`${new Date().toISOString()} ${message}`)
}

/** Write JSON atomically (temp file and rename), mode 600. */
export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  chmodSync(temp, 0o600)
  renameSync(temp, path)
}

// Config

export interface Config {
  /** Per-format auto mode: publish at the slot unless Hanif reacted ❌. Off by default. */
  auto: Record<FormatKey, boolean>
  /** R2 bucket and its public base URL (no trailing slash). Publishing is skipped until both are set. */
  r2: { bucket: string; publicBaseUrl: string } | null
}

export function readConfig(): Config {
  const raw = existsSync(CONFIG_FILE) ? JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) : {}
  const auto = { hoy: raw.auto?.hoy === true, finde: raw.auto?.finde === true, gratis: raw.auto?.gratis === true }
  const r2 = typeof raw.r2?.bucket === 'string' && typeof raw.r2?.publicBaseUrl === 'string'
    ? { bucket: raw.r2.bucket, publicBaseUrl: raw.r2.publicBaseUrl.replace(/\/+$/, '') }
    : null
  return { auto, r2 }
}

// Lock: one tick or command at a time.

export function withLock<T>(fn: () => Promise<T>, stateDir = STATE_DIR): Promise<T> {
  mkdirSync(stateDir, { recursive: true })
  const lock = join(stateDir, 'lock')
  try {
    mkdirSync(lock)
  } catch {
    // A lock older than an hour belongs to a process that died (ticks finish in minutes).
    if (Date.now() - statSync(lock).mtimeMs < 3_600_000) throw new Error(`Another run holds ${lock}`)
    rmSync(lock, { recursive: true, force: true })
    mkdirSync(lock)
  }
  return fn().finally(() => rmSync(lock, { recursive: true, force: true }))
}

// Catalog (read-only, through bin/ba-d1-read.sh)

const PAY_WHAT_YOU_WANT = /\ba la gorra\b|contribuci[oó]n consciente|a voluntad|pag[aá] lo que (quieras|puedas)/i

export function catalogSql(window: RunWindow): string {
  for (const date of [window.from, window.to]) if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`bad date ${date}`)
  const start = `${window.from}T03:00:00.000Z`
  const end = `${addDays(window.to, 1)}T03:00:00.000Z`
  return `SELECT e.id, e.name, e.starts_at, e.ends_at, e.price, e.is_free, e.status, e.time_tba, e.is_all_day, e.categories,
  e.description_summary_es AS summary, v.name AS venue, v.neighborhood AS barrio, v.instagram_handle AS venue_handle,
  (SELECT o.source_username FROM event_source_evidence x JOIN intake_observations o ON o.id = x.observation_id
    WHERE x.event_id = e.id ORDER BY o.observed_at LIMIT 1) AS source_account,
  (SELECT json_extract(c.payload, '$.price_note') FROM event_source_evidence x JOIN intake_candidates c ON c.id = x.candidate_id
    WHERE x.event_id = e.id AND json_extract(c.payload, '$.price_kind') = 'conditional' LIMIT 1) AS price_note,
  EXISTS (SELECT 1 FROM event_source_evidence x JOIN intake_candidates c ON c.id = x.candidate_id
    WHERE x.event_id = e.id AND json_extract(c.payload, '$.intent') <> 'link' AND json_extract(c.payload, '$.time') IS NULL) AS intake_time_unknown
FROM events e JOIN venues v ON v.id = e.venue_id
WHERE e.status = 'scheduled' AND e.starts_at >= '${start}' AND e.starts_at < '${end}' AND coalesce(e.location_hidden, 0) = 0
  AND EXISTS (SELECT 1 FROM event_source_evidence x WHERE x.event_id = e.id)
ORDER BY e.starts_at`
}

export function toCatalogEvent(row: Record<string, any>): CatalogEvent {
  return {
    id: row.id,
    name: row.name,
    startsAt: row.starts_at,
    endsAt: row.ends_at ?? null,
    price: row.price ?? null,
    isFree: row.is_free === 1,
    payWhatYouWant: typeof row.price_note === 'string' && PAY_WHAT_YOU_WANT.test(row.price_note),
    status: row.status,
    timeTba: row.time_tba === 1,
    isAllDay: row.is_all_day === 1,
    categories: (() => { try { return JSON.parse(row.categories ?? '[]') } catch { return [] } })(),
    summary: row.summary ?? null,
    venue: row.venue ?? null,
    barrio: row.barrio ?? null,
    venueHandle: row.venue_handle ?? null,
    sourceAccount: row.source_account ?? null,
    intakeTimeUnknown: row.intake_time_unknown === 1,
  }
}

async function d1Read(sql: string): Promise<unknown> {
  const { out, err, code } = await run([join(REPO, 'bin/ba-d1-read.sh'), sql], 120_000)
  if (code !== 0) throw new Error(`D1 read failed: ${err.trim().slice(0, 300)}`)
  return JSON.parse(out)
}

export interface EventNow { status: string; startsAt: string | null; endsAt: string | null }

/** Each id's current status and times (status 'missing' when the row is gone). Ids are UUIDs; anything else is refused. */
export async function readEvents(ids: string[]): Promise<Map<string, EventNow>> {
  if (ids.some(id => !/^[0-9a-f-]{36}$/.test(id))) throw new Error('Refusing to query non-UUID event ids')
  const rows = await d1Read(`SELECT id, status, starts_at, ends_at FROM events WHERE id IN (${ids.map(id => `'${id}'`).join(', ')})`)
  if (!Array.isArray(rows) || rows.some(row => typeof row?.id !== 'string' || typeof row?.status !== 'string' || typeof row?.starts_at !== 'string')) {
    throw new Error(`D1 read returned an error: ${JSON.stringify(rows).slice(0, 300)}`)
  }
  const events = new Map<string, EventNow>(ids.map(id => [id, { status: 'missing', startsAt: null, endsAt: null }]))
  for (const row of rows) events.set(row.id, { status: row.status, startsAt: row.starts_at, endsAt: row.ends_at ?? null })
  return events
}

export async function readCatalog(window: RunWindow): Promise<CatalogEvent[]> {
  const rows = await d1Read(catalogSql(window)) as any
  if (!Array.isArray(rows) || rows.some(row => typeof row?.id !== 'string' || typeof row?.starts_at !== 'string')) {
    throw new Error(`D1 read returned an error: ${JSON.stringify(rows).slice(0, 300)}`)
  }
  return rows.map(toCatalogEvent)
}

// Rendering: Playwright's Chromium, in a memory-capped scope.

function chromiumPath(): string {
  if (process.env.BA_INSTAGRAM_CHROMIUM) return process.env.BA_INSTAGRAM_CHROMIUM
  const root = join(HOME, '.cache/ms-playwright')
  const shells = existsSync(root) ? readdirSync(root).filter(name => /^chromium_headless_shell-\d+$/.test(name)) : []
  const newest = shells.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0]
  if (!newest) throw new Error(`No Chromium headless shell in ${root}`)
  return join(root, newest, 'chrome-headless-shell-linux64/chrome-headless-shell')
}

/** Runs in the child process: screenshot every `.s` element of the page to frame-N.jpg. */
export async function renderFramesInProcess(htmlFile: string, outDir: string, height: number): Promise<number> {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--disable-gpu', '--font-render-hinting=none'] })
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height }, deviceScaleFactor: 1 })
    await page.goto(`file://${htmlFile}`, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    const frames = await page.locator('.s').all()
    for (const [index, frame] of frames.entries()) {
      await frame.screenshot({ path: join(outDir, `frame-${index + 1}.jpg`), type: 'jpeg', quality: 92 })
    }
    return frames.length
  } finally {
    await browser.close()
  }
}

export type Runner = typeof run

/**
 * Render in a child process inside a named transient scope (900 MB, no swap, RuntimeMaxSec), so a timeout or a crash
 * can stop the whole scope with every Chromium process in it, not just the direct child.
 */
export async function renderFrames(html: string, outDir: string, height: number, runner: Runner = run): Promise<string[]> {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const htmlFile = join(outDir, 'frames.html')
  writeFileSync(htmlFile, html)
  const entry = join(REPO, 'scripts/instagram-publisher.ts')
  const command = [process.execPath, entry, 'render-frames', htmlFile, outDir, String(height)]
  const unit = `ba-events-instagram-render-${process.pid}-${Date.now()}`
  const scoped = process.env.BA_INSTAGRAM_RENDER_NO_SCOPE === '1'
    ? command
    : ['systemd-run', '--user', '--scope', '--quiet', `--unit=${unit}`, '-p', 'MemoryMax=900M', '-p', 'MemorySwapMax=0', '-p', 'RuntimeMaxSec=170', ...command]
  let result: Awaited<ReturnType<Runner>>
  try {
    result = await runner(scoped, 180_000, REPO)
  } catch (error) {
    result = { out: '', err: (error as Error).message, code: -1 }
  }
  if (result.code !== 0) {
    // Killed on timeout (code null) or failed: stop the scope so no Chromium process outlives the render.
    if (scoped !== command) await runner(['systemctl', '--user', 'stop', `${unit}.scope`], 30_000).catch(() => undefined)
    throw new Error(`Rendering failed (${result.code === null ? 'timed out' : `exit ${result.code}`}): ${result.err.trim().slice(-500)}`)
  }
  return readdirSync(outDir).filter(name => /^frame-\d+\.jpg$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    .map(name => join(outDir, name))
}

export const fileHash = (paths: string[]) => {
  const hash = createHash('sha256')
  for (const path of paths) hash.update(readFileSync(path))
  return hash.digest('hex').slice(0, 16)
}

// Slack, through Hermes' slack_api.py (it reads the bot token itself).

export async function slack(method: string, args: Record<string, string>): Promise<any> {
  // The args file holds only message text and ids; the bot token stays inside slack_api.py.
  const dir = join(STATE_DIR, 'tmp')
  mkdirSync(dir, { recursive: true })
  const argsFile = join(dir, `slack-${process.pid}-${Date.now()}.json`)
  writeFileSync(argsFile, JSON.stringify(args), { mode: 0o600 })
  try {
    const { out, err } = await run(['python3', '-I', SLACK_API, '--form', method, `@file=${argsFile}`], 60_000)
    const body = (() => { try { return JSON.parse(out) } catch { return null } })()
    if (!body?.ok) throw new Error(`Slack ${method} failed: ${body?.error ?? err.trim().slice(0, 200)}`)
    return body
  } finally {
    rmSync(argsFile, { force: true })
  }
}

/** Upload the frames (not yet shared). Returns Slack's file ids and titles. */
export async function slackUploadFiles(frames: string[], draftId: string): Promise<Array<{ id: string; title: string }>> {
  const files: Array<{ id: string; title: string }> = []
  for (const [index, path] of frames.entries()) {
    const bytes = readFileSync(path)
    const filename = `${draftId}-${index + 1}.jpg`
    const { upload_url: uploadUrl, file_id: id } = await slack('files.getUploadURLExternal', { filename, length: String(bytes.length) })
    const response = await fetch(uploadUrl, { method: 'POST', body: bytes, signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`Slack file upload failed: HTTP ${response.status}`)
    files.push({ id, title: filename })
  }
  return files
}

/** Share uploaded files in one new top-level message in #ba-eventos. */
export const slackShareFiles = (files: Array<{ id: string; title: string }>, text: string) =>
  slack('files.completeUploadExternal', { files: JSON.stringify(files), channel_id: SLACK_CHANNEL, initial_comment: text })

/** The ts of the message a shared file landed in. Slack fills `shares` a moment after the upload completes. */
export async function slackShareTs(fileId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { file } = await slack('files.info', { file: fileId })
    const ts = file?.shares?.public?.[SLACK_CHANNEL]?.[0]?.ts ?? file?.shares?.private?.[SLACK_CHANNEL]?.[0]?.ts
    if (ts) return ts
    await sleep(3_000)
  }
  return null
}

export const slackPost = (text: string, threadTs?: string) =>
  slack('chat.postMessage', { channel: SLACK_CHANNEL, text, ...(threadTs ? { thread_ts: threadTs } : {}), unfurl_links: 'false' })

export async function slackReactions(ts: string) {
  const { message } = await slack('reactions.get', { channel: SLACK_CHANNEL, timestamp: ts, full: 'true' })
  return message?.reactions as Array<{ name: string; users?: string[] }> | undefined
}

// R2, through the Cloudflare API with the same token file bin/ba-d1-read.sh reads.

export async function r2Put(bucket: string, key: string, path: string) {
  const token = readFileSync(CF_TOKEN_FILE, 'utf8').trim()
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/r2/buckets/${bucket}/objects/${key.split('/').map(encodeURIComponent).join('/')}`
  const response = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
    body: readFileSync(path),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(`R2 upload of ${key} failed: HTTP ${response.status}`)
}

// The Instagram token

export interface InstagramToken { access_token: string; ig_user_id: string; expires_at: string; refreshed_at?: string }

export type TokenCheck =
  | { state: 'missing' }
  | { state: 'ok'; token: InstagramToken; warning: string | null }

const DAY = 86_400_000

/** Read the token, refresh it when it's more than 7 days old, and say whether it needs Hermes. Never prints it. */
export async function loadToken(now: Date, fetchImpl: typeof fetch = fetch, file = TOKEN_FILE): Promise<TokenCheck> {
  if (!existsSync(file)) return { state: 'missing' }
  const token = JSON.parse(readFileSync(file, 'utf8')) as InstagramToken
  if (!token.access_token || !token.ig_user_id || !token.expires_at) throw new Error(`${file} lacks access_token, ig_user_id, or expires_at`)
  const issued = Date.parse(token.refreshed_at ?? '') || statSync(file).mtimeMs
  let warning: string | null = null
  if (now.getTime() - issued > 7 * DAY && Date.parse(token.expires_at) > now.getTime()) {
    try {
      const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token.access_token)}`
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) })
      const body = await response.json().catch(() => null) as any
      if (!response.ok || typeof body?.access_token !== 'string' || typeof body?.expires_in !== 'number') {
        throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
      }
      token.access_token = body.access_token
      token.expires_at = new Date(now.getTime() + body.expires_in * 1000).toISOString()
      token.refreshed_at = now.toISOString()
      writeJson(file, token)
    } catch (error) {
      warning = `The Instagram token refresh failed: ${(error as Error).message}`
    }
  }
  const daysLeft = (Date.parse(token.expires_at) - now.getTime()) / DAY
  if (daysLeft < 10) warning = [warning, `The Instagram token expires in ${Math.max(0, Math.floor(daysLeft))} days (${token.expires_at}).`].filter(Boolean).join(' ')
  return { state: 'ok', token, warning }
}

// Alerts

export async function alert(key: string, title: string, text: string) {
  const { err, code } = await run([ALERT, 'raise', `ba-events/instagram/${key}`, '--title', title, '--text', text], 60_000)
  if (code !== 0) log(`alert raise failed: ${err.trim()}`)
}

export async function resolveAlert(key: string) {
  await run([ALERT, 'resolve', `ba-events/instagram/${key}`, '--quiet'], 60_000)
}

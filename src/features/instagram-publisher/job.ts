/** The tick, dry-run, regenerate, and status commands. One JSON state file per draft under STATE_DIR/drafts. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decide, readReactions } from './approval.ts'
import { caption as captionFor, postedText, skipText, slackPreview, tooFewText, type SkipReason } from './copy.ts'
import { FORMATS, activeRuns, draftId, parseDraftId, runWindow, type FormatKey, type RunWindow } from './formats.ts'
import { FRAME, framesHtml } from './html.ts'
import { emptyPublishState, footerTag, instagramApi, publish, type PublishState, type Slide } from './instagram.ts'
import {
  REPO, STATE_DIR, alert, fileHash, loadToken, log, r2Put, readCatalog, readConfig, renderFrames, resolveAlert,
  sleep, slackPost, slackReactions, slackShareFiles, slackShareTs, slackUploadFiles, withLock, writeJson,
} from './runtime.ts'
import { selectEvents, type PostEvent } from './select.ts'

export type DraftState = 'previewing' | 'previewed' | 'publishing' | 'published' | 'skipped' | 'failed'

export interface Draft {
  id: string
  format: FormatKey
  from: string
  to: string
  state: DraftState
  exclude: string[]
  events: PostEvent[]
  caption: string | null
  frames: string[]
  framesHash: string
  slack: { fileIds: string[]; ts: string | null }
  approvedSeenAt: string | null
  r2Uploaded: string | null
  publish: PublishState | null
  publishFailures: number
  skipReason: string | null
  note: string | null
  updatedAt: string
}

const DRAFTS = join(STATE_DIR, 'drafts')
const draftFile = (id: string) => join(DRAFTS, `${id}.json`)
const framesDir = (id: string) => join(DRAFTS, id)
const MAX_PUBLISH_FAILURES = 6
const TERMINAL: DraftState[] = ['published', 'skipped', 'failed']

function loadDraft(id: string): Draft | null {
  return existsSync(draftFile(id)) ? JSON.parse(readFileSync(draftFile(id), 'utf8')) : null
}

function saveDraft(draft: Draft) {
  draft.updatedAt = new Date().toISOString()
  writeJson(draftFile(draft.id), draft)
}

function allDrafts(): Draft[] {
  if (!existsSync(DRAFTS)) return []
  return readdirSync(DRAFTS).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(join(DRAFTS, name), 'utf8')))
}

const heightOf = (format: FormatKey) => FRAME[FORMATS[format].kind].height
const assets = () => ({
  fontsDir: join(REPO, 'src/features/instagram-publisher/assets/fonts'),
  heroPhoto: join(REPO, 'static/hero-rooftop-buenos-aires.jpg'),
})

interface Built { window: RunWindow; events: PostEvent[]; caption: string | null; frames: string[] | null }

/** Read the catalog, pick the events, and render the frames when enough events qualify. */
async function build(format: FormatKey, from: string, exclude: string[], outDir: string): Promise<Built> {
  const window = runWindow(format, from)
  const events = selectEvents(await readCatalog(window), format, window, exclude)
  if (events.length < FORMATS[format].min) return { window, events, caption: null, frames: null }
  const frames = await renderFrames(framesHtml(format, window, events, assets()), outDir, heightOf(format))
  return { window, events, caption: captionFor(format, events), frames }
}

// dry-run

export async function dryRun(format: FormatKey, from: string, outDir: string) {
  const work = join(outDir, '.render')
  const built = await build(format, from, [], work)
  mkdirSync(outDir, { recursive: true })
  const summary = built.events.map(event => `${event.id}  ${event.date} ${event.time}  ${event.title} · ${event.venue} (${event.barrio})${event.handle ? ` @${event.handle}` : ''}${event.price ? ` · ${event.price}` : ''}`)
  writeFileSync(join(outDir, 'events.txt'), `${summary.join('\n')}\n`)
  if (!built.frames) {
    const text = tooFewText(format, built.window, built.events.length)
    writeFileSync(join(outDir, 'slack.txt'), `${text}\n`)
    rmSync(work, { recursive: true, force: true })
    console.log(text)
    return
  }
  built.frames.forEach((path, index) => copyFileSync(path, join(outDir, `${format === 'hoy' ? 'frame' : 'slide'}-${index + 1}.jpg`)))
  rmSync(work, { recursive: true, force: true })
  writeFileSync(join(outDir, 'caption.txt'), `${built.caption ?? 'Stories have no caption.'}\n`)
  writeFileSync(join(outDir, 'slack.txt'), `${slackPreview(format, built.window, built.caption, readConfig().auto[format])}\n`)
  console.log(`${built.frames.length} frames and the caption written to ${outDir}`)
}

// Drafting and previewing

const buildDraft = (format: FormatKey, from: string, exclude: string[]) => build(format, from, exclude, join(framesDir(draftId(format, from)), 'next'))

async function createDraft(format: FormatKey, from: string, exclude: string[], built: Built): Promise<Draft> {
  const id = draftId(format, from)
  const draft: Draft = {
    id, format, from, to: built.window.to, state: 'previewing', exclude, events: built.events, caption: built.caption,
    frames: [], framesHash: '', slack: { fileIds: [], ts: null }, approvedSeenAt: null, r2Uploaded: null, publish: null,
    publishFailures: 0, skipReason: null, note: null, updatedAt: '',
  }
  if (!built.frames) {
    rmSync(framesDir(id), { recursive: true, force: true })
    draft.state = 'skipped'
    draft.skipReason = skipText({ kind: 'too-few', count: built.events.length })
    const posted = await slackPost(tooFewText(format, built.window, built.events.length))
    draft.slack.ts = posted.ts
    saveDraft(draft)
    log(`${id}: ${draft.skipReason}`)
    return draft
  }
  // Swap the freshly rendered frames into place only now, so a failed rebuild leaves the old ones alone.
  const current = join(framesDir(id), 'current')
  rmSync(current, { recursive: true, force: true })
  mkdirSync(current, { recursive: true })
  draft.frames = built.frames.map((path, index) => { const target = join(current, `frame-${index + 1}.jpg`); copyFileSync(path, target); return target })
  rmSync(join(framesDir(id), 'next'), { recursive: true, force: true })
  draft.framesHash = fileHash(draft.frames)
  saveDraft(draft)
  await sendPreview(draft)
  return draft
}

async function sendPreview(draft: Draft) {
  if (draft.slack.fileIds.length && !draft.slack.ts) {
    // An earlier run uploaded the files but didn't learn where they landed; look before posting again.
    draft.slack.ts = await slackShareTs(draft.slack.fileIds[0]!)
    if (!draft.slack.ts) { draft.slack.fileIds = []; saveDraft(draft) }
  }
  if (!draft.slack.ts) {
    const window = runWindow(draft.format, draft.from)
    const text = slackPreview(draft.format, window, draft.caption, readConfig().auto[draft.format])
    const files = await slackUploadFiles(draft.frames, draft.id)
    // Saved before sharing: if the share's answer is lost, the next tick looks the message up instead of posting again.
    draft.slack.fileIds = files.map(file => file.id)
    saveDraft(draft)
    await slackShareFiles(files, text)
    draft.slack.ts = await slackShareTs(draft.slack.fileIds[0]!)
    if (!draft.slack.ts) throw new Error(`${draft.id}: the preview was uploaded but Slack didn't report its message yet`)
  }
  draft.state = 'previewed'
  saveDraft(draft)
  log(`${draft.id}: preview posted (${draft.slack.ts})`)
}

// Publishing

async function skip(draft: Draft, reason: SkipReason) {
  draft.state = 'skipped'
  draft.skipReason = skipText(reason)
  saveDraft(draft)
  if (draft.slack.ts) await slackPost(draft.skipReason, draft.slack.ts)
  log(`${draft.id}: ${draft.skipReason}`)
}

/** Returns false when publishing had to be skipped for missing setup (token or R2). */
async function publishDraft(draft: Draft, now: Date): Promise<boolean> {
  const config = readConfig()
  const token = await loadToken(now)
  if (token.state === 'missing') { log(`${draft.id}: no Instagram token file; skipping publishing`); return false }
  if (!config.r2) { log(`${draft.id}: no R2 bucket in the config; skipping publishing`); return false }
  const prefix = `instagram/${draft.id}/${draft.framesHash}`
  if (draft.r2Uploaded !== prefix) {
    for (const [index, path] of draft.frames.entries()) await r2Put(config.r2.bucket, `${prefix}/frame-${index + 1}.jpg`, path)
    draft.r2Uploaded = prefix
    saveDraft(draft)
  }
  const kind = FORMATS[draft.format].kind
  const height = heightOf(draft.format)
  // Frame 1 is the cover and the last one the closing frame; the cards in between carry the tags.
  const slides: Slide[] = draft.frames.map((_, index) => {
    const handle = index > 0 && index <= draft.events.length ? draft.events[index - 1]!.handle : null
    return { url: `${config.r2!.publicBaseUrl}/${prefix}/frame-${index + 1}.jpg`, tag: handle ? footerTag(handle, height) : null }
  })
  const job = { kind, igUserId: token.token.ig_user_id, slides, caption: draft.caption }
  draft.publish ??= emptyPublishState(job)
  draft.state = 'publishing'
  saveDraft(draft)
  const permalink = await publish(job, draft.publish, {
    api: instagramApi(token.token.access_token),
    save: state => { draft.publish = state; saveDraft(draft) },
    now: () => new Date(),
    sleep,
    log: message => log(`${draft.id}: ${message}`),
  })
  draft.state = 'published'
  saveDraft(draft)
  log(`${draft.id}: published ${permalink}`)
  await slackPost(postedText(permalink), draft.slack.ts ?? undefined)
  return true
}

async function advance(draft: Draft, now: Date) {
  if (draft.state === 'previewing' && now >= runWindow(draft.format, draft.from).cutoff) {
    draft.state = 'failed'
    draft.note = 'The preview never reached Slack before the cutoff.'
    return saveDraft(draft)
  }
  if (draft.state === 'previewing') await sendPreview(draft)
  if (draft.state === 'previewed') {
    const window = runWindow(draft.format, draft.from)
    const reactions = readReactions(await slackReactions(draft.slack.ts!))
    if (reactions.approved && !draft.approvedSeenAt) { draft.approvedSeenAt = now.toISOString(); saveDraft(draft) }
    const auto = readConfig().auto[draft.format]
    const decision = decide(window, reactions, draft.approvedSeenAt ? new Date(draft.approvedSeenAt) : null, auto, now)
    if (decision.action === 'skip') return skip(draft, decision.reason)
    if (decision.action === 'wait') return
  }
  if (draft.state === 'previewed' || draft.state === 'publishing') {
    try {
      const done = await publishDraft(draft, now)
      if (!done && now >= new Date(runWindow(draft.format, draft.from).cutoff.getTime() + 10 * 60_000) && draft.state === 'previewed') {
        draft.state = 'failed'
        draft.note = 'Not published: the Instagram token or the R2 setup was missing.'
        saveDraft(draft)
      }
      await resolveAlert(`draft/${draft.id}`)
    } catch (error) {
      draft.publishFailures++
      draft.note = (error as Error).message
      if (draft.publishFailures >= MAX_PUBLISH_FAILURES && !draft.publish?.units.some(unit => unit.pendingSince)) draft.state = 'failed'
      saveDraft(draft)
      await alert(`draft/${draft.id}`, `Instagram ${draft.id} didn't publish`, `${draft.note} (attempt ${draft.publishFailures}${draft.state === 'failed' ? ', giving up' : ', retrying next tick'}). State: ${draftFile(draft.id)}`)
    }
  }
}

/** Remove local frames of finished drafts after 14 days; the state files stay. */
function prune(now: Date) {
  for (const draft of allDrafts()) {
    if (TERMINAL.includes(draft.state) && now.getTime() - Date.parse(draft.updatedAt) > 14 * 86_400_000 && existsSync(framesDir(draft.id))) {
      rmSync(framesDir(draft.id), { recursive: true, force: true })
    }
  }
}

export async function tick(now = new Date()) {
  await withLock(async () => {
    const token = await loadToken(now).catch(error => ({ state: 'ok' as const, warning: (error as Error).message }))
    if (token.state === 'ok' && token.warning) await alert('token', 'Instagram token needs attention', token.warning)
    else if (token.state === 'ok') await resolveAlert('token')
    const failures: string[] = []
    for (const format of Object.keys(FORMATS) as FormatKey[]) {
      for (const from of activeRuns(format, now)) {
        if (loadDraft(draftId(format, from))) continue
        try { await createDraft(format, from, [], await buildDraft(format, from, [])) } catch (error) { failures.push(`${draftId(format, from)}: ${(error as Error).message}`) }
      }
    }
    for (const draft of allDrafts().filter(draft => !TERMINAL.includes(draft.state))) {
      try { await advance(draft, now) } catch (error) { failures.push(`${draft.id}: ${(error as Error).message}`) }
    }
    prune(now)
    if (failures.length) {
      for (const failure of failures) log(failure)
      // The alert is the report; exiting 0 keeps notify-failure for crashes the tick couldn't catch.
      await alert('tick', 'Instagram publisher tick failed', failures.join('\n'))
    } else {
      await resolveAlert('tick')
    }
  })
}

export async function regenerate(id: string, excludeIds: string[]) {
  const { format, from } = parseDraftId(id)
  await withLock(async () => {
    const old = loadDraft(id)
    if (!old) throw new Error(`No draft ${id}; see \`status\``)
    if (old.state === 'publishing' || old.state === 'published') throw new Error(`${id} is ${old.state}; it can't be rebuilt`)
    const window = runWindow(format, from)
    if (new Date() >= window.cutoff) throw new Error(`${id} is past its cutoff`)
    const exclude = [...new Set([...old.exclude, ...excludeIds])]
    const built = await buildDraft(format, from, exclude)
    if (!built.frames) throw new Error(`Without ${excludeIds.join(', ')} only ${built.events.length} events qualify; the draft is unchanged`)
    // The new draft is a new top-level preview; reactions on the old message no longer count.
    const draft = await createDraft(format, from, exclude, built)
    console.log(`${draft.id}: rebuilt with ${draft.events.length} events and previewed again (${draft.slack.ts})`)
  })
}

export function status() {
  const drafts = allDrafts().sort((a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id))
  if (!drafts.length) { console.log('No drafts yet.'); return }
  const fmt = (date: Date) => date.toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 16)
  for (const draft of drafts) {
    const window = runWindow(draft.format, draft.from)
    const extra = draft.state === 'published' ? draft.publish?.permalink : draft.skipReason ?? draft.note
    console.log([draft.id.padEnd(18), draft.state.padEnd(10), `draft ${fmt(window.draftAt)}`, `publish ${fmt(window.publishAt)}`, `cutoff ${fmt(window.cutoff)}`, `${draft.events.length} events`, extra ?? ''].join('  ').trimEnd())
  }
}

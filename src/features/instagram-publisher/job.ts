/**
 * The tick, dry-run, regenerate, and status commands. One JSON state file per draft under <state>/drafts.
 *
 * A draft moves previewing → previewed → publishing → published | skipped | failed | held. Every Instagram write
 * re-checks Hanif's current reactions and the deadline (`beforeWrite`). The Slack reply that reports the outcome is a
 * separate pending step (`notify`), saved with the outcome and retried by later ticks until Slack takes it.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PublishStop, checkWrite, decide, readReactions } from './approval.ts'
import * as alerts from './alerts.ts'
import { caption as captionFor, footerHandle, heldText, postedText, skipText, slackPreview, tooFewText, type SkipReason } from './copy.ts'
import { FORMATS, activeRuns, draftId, parseDraftId, runWindow, type FormatKey, type RunWindow } from './formats.ts'
import { FRAME, framesHtml } from './html.ts'
import { StillProcessing, emptyPublishState, footerTag, instagramApi, publish, type InstagramApi, type PublishJob, type PublishState, type Slide } from './instagram.ts'
import { nextTrack, readTracks, readyTrack, type DraftTrack, type ReadyTrack } from './reel/music.ts'
import { reelTiming, type ReelTiming } from './reel/project.ts'
import * as runtime from './runtime.ts'
import type { Config, EventNow, TokenCheck } from './runtime.ts'
import { selectEvents, type CatalogEvent, type PostEvent } from './select.ts'

export type DraftState = 'previewing' | 'previewed' | 'publishing' | 'published' | 'skipped' | 'failed' | 'held' | 'rebuilding'

export interface Draft {
  id: string
  format: FormatKey
  from: string
  to: string
  /** Bumped by every regenerate; frames live in their own rev-<n> directory and approval belongs to one revision. */
  revision: number
  state: DraftState
  exclude: string[]
  events: PostEvent[]
  caption: string | null
  /** Rendered files: the frames, or for a Reel the MP4 and its cover image. */
  frames: string[]
  /** Reel only: the track this draft uses (kept by regenerate unless --track picks another). */
  track?: DraftTrack | null
  framesHash: string
  slack: { fileIds: string[]; ts: string | null }
  approvedSeenAt: string | null
  r2Uploaded: string | null
  publish: PublishState | null
  /** Total failures for the publish retry budget, separate from the shared tick streak. */
  publishFailures: number
  /** A Slack message still to deliver for this draft's outcome. */
  notify: { text: string; threadTs: string | null; failures?: number } | null
  skipReason: string | null
  note: string | null
  updatedAt: string
}

/** Everything the job touches outside its state directory. Tests replace these with fakes. */
export interface Services {
  stateDir: string
  repo: string
  now(): Date
  config(): Config
  readCatalog(window: RunWindow): Promise<CatalogEvent[]>
  readEvents(ids: string[]): Promise<Map<string, EventNow>>
  render(html: string, outDir: string, height: number): Promise<string[]>
  /** Returns [reel.mp4, cover.jpg]. */
  renderReel(window: RunWindow, events: PostEvent[], timing: ReelTiming, track: ReadyTrack, outDir: string): Promise<string[]>
  slackUploadFiles(frames: string[], draftId: string): Promise<Array<{ id: string; title: string }>>
  slackShareFiles(files: Array<{ id: string; title: string }>, text: string): Promise<unknown>
  slackShareTs(fileId: string): Promise<string | null>
  slackPost(text: string, threadTs?: string): Promise<{ ts: string }>
  slackReactions(ts: string): Promise<Array<{ name: string; users?: string[] }> | undefined>
  r2Put(bucket: string, key: string, path: string): Promise<void>
  loadToken(now: Date): Promise<TokenCheck>
  instagram(accessToken: string): InstagramApi
  alert(key: string, title: string, text: string, fingerprint?: string): Promise<void>
  resolveAlert(key: string, text?: string): Promise<boolean | void>
  sleep(ms: number): Promise<void>
  log(message: string): void
}

export const liveServices = (): Services => ({
  stateDir: runtime.STATE_DIR,
  repo: runtime.REPO,
  now: () => new Date(),
  config: runtime.readConfig,
  readCatalog: runtime.readCatalog,
  readEvents: runtime.readEvents,
  render: (html, outDir, height) => runtime.renderFrames(html, outDir, height),
  renderReel: runtime.renderReel,
  slackUploadFiles: runtime.slackUploadFiles,
  slackShareFiles: runtime.slackShareFiles,
  slackShareTs: runtime.slackShareTs,
  slackPost: runtime.slackPost,
  slackReactions: runtime.slackReactions,
  r2Put: runtime.r2Put,
  loadToken: now => runtime.loadToken(now),
  instagram: token => instagramApi(token),
  alert: runtime.alert,
  resolveAlert: runtime.resolveAlert,
  sleep: runtime.sleep,
  log: runtime.log,
})

const MAX_PUBLISH_FAILURES = 6
/** States a tick no longer advances (a pending notification is still delivered). */
const SETTLED: DraftState[] = ['published', 'skipped', 'failed', 'held']

export class Job {
  constructor(readonly s: Services) {}

  private get drafts() { return join(this.s.stateDir, 'drafts') }
  draftFile(id: string) { return join(this.drafts, `${id}.json`) }
  private framesDir(id: string) { return join(this.drafts, id) }

  loadDraft(id: string): Draft | null {
    return existsSync(this.draftFile(id)) ? JSON.parse(readFileSync(this.draftFile(id), 'utf8')) : null
  }

  private save(draft: Draft) {
    draft.updatedAt = this.s.now().toISOString()
    runtime.writeJson(this.draftFile(draft.id), draft)
  }

  allDrafts(): Draft[] {
    if (!existsSync(this.drafts)) return []
    return readdirSync(this.drafts).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(join(this.drafts, name), 'utf8')))
  }

  private assets() {
    return { fontsDir: join(this.s.repo, 'src/features/instagram-publisher/assets/fonts'), heroPhoto: join(this.s.repo, 'static/hero-rooftop-buenos-aires.jpg') }
  }

  /** The Reel track for a new draft: the one whose last published Reel is oldest, never-published tracks first. */
  chooseTrack(): string {
    const published = this.allDrafts().filter(draft => draft.format === 'reel' && draft.state === 'published' && draft.track)
      .map(draft => ({ track: draft.track!.id, from: draft.from }))
    return nextTrack(readTracks(this.s.config().reel.musicDir), published).id
  }

  /**
   * Read the catalog, pick the events, and render when enough events qualify. A Reel also leaves out the finde
   * draft's exclusions and needs its track (`trackId`), which must be measured and present, or the build fails.
   */
  async build(format: FormatKey, from: string, exclude: string[], outDir: string, trackId: string | null = null) {
    const window = runWindow(format, from)
    const skip = format === 'reel' ? [...exclude, ...(this.loadDraft(draftId('finde', from))?.exclude ?? [])] : exclude
    const events = selectEvents(await this.s.readCatalog(window), format, window, skip)
    if (events.length < FORMATS[format].min) return { window, events, caption: null, frames: null, track: null, timing: null }
    if (format === 'reel') {
      const track = readyTrack(this.s.config().reel.musicDir, trackId!)
      const timing = reelTiming(window, events, track.bpm)
      const frames = await this.s.renderReel(window, events, timing, track, outDir)
      const saved: DraftTrack = { id: track.id, title: track.title, artist: track.artist, credit: track.credit }
      return { window, events, caption: captionFor(format, events, track.credit), frames, track: saved, timing }
    }
    const frames = await this.s.render(framesHtml(format, window, events, this.assets()), outDir, FRAME[FORMATS[format].kind as 'story' | 'carousel'].height)
    return { window, events, caption: captionFor(format, events), frames, track: null, timing: null }
  }

  // Drafting and previewing

  /** Build revision `revision` of a draft into its own directory and preview it. Approval always starts empty. */
  async createDraft(format: FormatKey, from: string, exclude: string[], revision: number, trackId: string | null = null): Promise<Draft> {
    const id = draftId(format, from)
    const dir = join(this.framesDir(id), `rev-${revision}`)
    const built = await this.build(format, from, exclude, dir, format === 'reel' ? trackId ?? this.chooseTrack() : null)
    const draft: Draft = {
      id, format, from, to: built.window.to, revision, state: 'previewing', exclude, events: built.events, caption: built.caption, track: built.track,
      frames: built.frames ?? [], framesHash: built.frames ? runtime.fileHash(built.frames) : '', slack: { fileIds: [], ts: null },
      approvedSeenAt: null, r2Uploaded: null, publish: null, publishFailures: 0, notify: null, skipReason: null, note: null, updatedAt: '',
    }
    if (!built.frames) {
      rmSync(dir, { recursive: true, force: true })
      draft.state = 'skipped'
      draft.skipReason = skipText({ kind: 'too-few', count: built.events.length })
      draft.notify = { text: tooFewText(format, built.window, built.events.length), threadTs: null }
      this.save(draft)
      this.s.log(`${id}: ${draft.skipReason}`)
      await this.deliver(draft)
      return draft
    }
    this.save(draft)
    await this.sendPreview(draft)
    return draft
  }

  private async sendPreview(draft: Draft) {
    if (draft.slack.fileIds.length && !draft.slack.ts) {
      // An earlier run uploaded the files but didn't learn where they landed; look before posting again.
      draft.slack.ts = await this.s.slackShareTs(draft.slack.fileIds[0]!)
      if (!draft.slack.ts) { draft.slack.fileIds = []; this.save(draft) }
    }
    if (!draft.slack.ts) {
      this.verifyFrames(draft)
      const text = slackPreview(draft.format, runWindow(draft.format, draft.from), draft.caption, this.s.config().auto[draft.format], draft.track ?? undefined)
      // A Reel's preview attaches the video only.
      const files = await this.s.slackUploadFiles(draft.format === 'reel' ? draft.frames.slice(0, 1) : draft.frames, draft.id)
      // Saved before sharing: if the share's answer is lost, the next tick looks the message up instead of posting again.
      draft.slack.fileIds = files.map(file => file.id)
      this.save(draft)
      await this.s.slackShareFiles(files, text)
      draft.slack.ts = await this.s.slackShareTs(draft.slack.fileIds[0]!)
      if (!draft.slack.ts) throw new Error('Slack preview lookup failed: the upload has no message yet')
    }
    draft.state = 'previewed'
    this.save(draft)
    this.s.log(`${draft.id}: preview posted (${draft.slack.ts})`)
  }

  /** Fail closed when the frames on disk aren't the ones this revision previewed. */
  private verifyFrames(draft: Draft) {
    const dir = join(this.framesDir(draft.id), `rev-${draft.revision}`)
    if (!draft.frames.length || draft.frames.some(path => !path.startsWith(`${dir}/`)) || runtime.fileHash(draft.frames) !== draft.framesHash) {
      throw new Error(`${draft.id}: the frames on disk don't match revision ${draft.revision}; not uploading them`)
    }
  }

  // Outcomes and notifications

  /** Record an outcome and its Slack message together, then try to deliver it. */
  private async settle(draft: Draft, state: DraftState, text: string | null, extra: Partial<Draft> = {}) {
    Object.assign(draft, extra)
    draft.state = state
    draft.notify = text && draft.slack.ts ? { text, threadTs: draft.slack.ts } : null
    this.save(draft)
    this.s.log(`${draft.id}: ${state}${text ? ` (${text})` : ''}`)
    await this.deliver(draft)
  }

  private async skip(draft: Draft, reason: SkipReason) {
    const text = skipText(reason)
    await this.settle(draft, 'skipped', text, { skipReason: text })
    if (draft.publishFailures && reason.kind !== 'too-few') {
      await this.s.resolveAlert(alerts.draftKey(draft), alerts.publishSkipped(draft, reason, this.s.now()))
    }
  }

  /** Deliver a pending Slack message. A failure leaves it pending for the next tick. */
  async deliver(draft: Draft) {
    const notify = draft.notify
    if (!notify) return
    const key = `${alerts.draftKey(draft)}/slack`
    let posted: { ts: string }
    try {
      posted = await this.s.slackPost(notify.text, notify.threadTs ?? undefined)
    } catch (error) {
      const failure = alerts.describeFailure(error)
      this.s.log(`${draft.id}: Slack reply failed: ${error}`)
      notify.failures = (notify.failures ?? 0) + 1
      this.save(draft)
      if (notify.failures >= alerts.ALERT_FAILURES) {
        await this.s.alert(key, alerts.draftTitle(draft), alerts.slackAlert(draft, failure, notify.failures, this.s.now()), failure.cause)
      }
      return
    }
    if (!draft.slack.ts && !notify.threadTs) draft.slack.ts = posted.ts
    draft.notify = null
    this.save(draft)
    // The alert command does nothing when no alert was open, including for replies queued on the old version.
    await this.s.resolveAlert(key, alerts.slackRecovered(draft, this.s.now(), notify.threadTs))
  }

  // Publishing

  /**
   * Throws a 'stale' stop when any selected event, read fresh from D1, is no longer scheduled or is already over at the
   * current time (ended, or started when it has no end), or no longer marked in scope.
   */
  private async checkEvents(draft: Draft) {
    const current = await this.s.readEvents(draft.events.map(event => event.id))
    const now = this.s.now().getTime()
    for (const event of draft.events) {
      const fresh = current.get(event.id)!
      if (fresh.status === 'past' || (fresh.status === 'scheduled' && Date.parse(fresh.endsAt ?? fresh.startsAt!) <= now)) {
        const detail = fresh.status === 'past' ? 'is marked past' : `${fresh.endsAt ? 'ended' : 'started'} at ${fresh.endsAt ?? fresh.startsAt}`
        throw new PublishStop('stale', `${event.title} has already happened`, { id: event.id, title: event.title, why: 'over', detail })
      }
      if (fresh.status !== 'scheduled') {
        throw new PublishStop('stale', `${event.title} is ${fresh.status}`, { id: event.id, title: event.title, why: 'cancelled', detail: `is ${fresh.status}` })
      }
      if (!fresh.inScope) {
        throw new PublishStop('stale', `${event.title} is no longer marked in scope`, { id: event.id, title: event.title, why: 'scope', detail: 'is not marked in scope' })
      }
    }
  }

  /** Returns false when publishing had to be skipped for missing setup (token or R2). */
  private async publishDraft(draft: Draft, window: RunWindow): Promise<boolean> {
    const config = this.s.config()
    const token = await this.s.loadToken(this.s.now())
    if (token.state === 'missing') { this.s.log(`${draft.id}: no Instagram token file; skipping publishing`); return false }
    if (!config.r2) { this.s.log(`${draft.id}: no R2 bucket in the config; skipping publishing`); return false }
    const auto = config.auto[draft.format]
    // Every write re-checks the reactions and the deadline; the first write of each attempt also re-checks the events.
    // Reconciling an earlier unclear publish never calls this, so it isn't blocked by any of these checks.
    let eventsChecked = false
    const beforeWrite = async () => {
      checkWrite(window, readReactions(await this.s.slackReactions(draft.slack.ts!)), auto, this.s.now())
      if (!eventsChecked) { await this.checkEvents(draft); eventsChecked = true }
    }
    if (!draft.publish) await beforeWrite()
    const prefix = `instagram/${draft.id}/${draft.framesHash}`
    const kind = FORMATS[draft.format].kind
    const names = kind === 'reel' ? ['reel.mp4', 'cover.jpg'] : draft.frames.map((_, index) => `frame-${index + 1}.jpg`)
    if (draft.r2Uploaded !== prefix) {
      this.verifyFrames(draft)
      for (const [index, path] of draft.frames.entries()) await this.s.r2Put(config.r2.bucket, `${prefix}/${names[index]}`, path)
      draft.r2Uploaded = prefix
      this.save(draft)
    }
    const url = (name: string) => `${config.r2!.publicBaseUrl}/${prefix}/${name}`
    let job: PublishJob
    if (kind === 'reel') {
      job = { kind, igUserId: token.token.ig_user_id, slides: [], caption: draft.caption, video: { url: url('reel.mp4'), coverUrl: url('cover.jpg') } }
    } else {
      const height = FRAME[kind].height
      // Frame 1 is the cover and the last one the closing frame; the cards in between carry the tags.
      const slides: Slide[] = draft.frames.map((_, index) => {
        const event = index > 0 && index <= draft.events.length ? draft.events[index - 1]! : null
        return { url: url(names[index]!), tag: event?.handle ? footerTag(event.handle, height, footerHandle(event)) : null }
      })
      job = { kind, igUserId: token.token.ig_user_id, slides, caption: draft.caption }
    }
    draft.publish ??= emptyPublishState(job)
    draft.state = 'publishing'
    this.save(draft)
    const permalink = await publish(job, draft.publish, {
      api: this.s.instagram(token.token.access_token),
      save: state => { draft.publish = state; this.save(draft) },
      now: () => this.s.now(),
      sleep: ms => this.s.sleep(ms),
      log: message => this.s.log(`${draft.id}: ${message}`),
      beforeWrite,
    })
    await this.settle(draft, 'published', postedText(permalink), { publishFailures: 0 })
    return true
  }

  /** A stop before a write: wait for a withdrawn ✅, otherwise end the draft without creating anything more. */
  private async stopped(draft: Draft, stop: PublishStop, window: RunWindow) {
    if (stop.kind === 'unapproved') { this.s.log(`${draft.id}: ${stop.message}; waiting`); return }
    const out = draft.publish?.units.filter(unit => unit.published || unit.mediaId).length ?? 0
    if (stop.kind === 'stale' && out === 0) {
      const { id, title, why, detail } = stop.stale!
      const text = heldText(title, why)
      await this.settle(draft, 'held', text, { note: `${id} ${detail}` })
      await this.s.alert(alerts.draftKey(draft), alerts.draftTitle(draft), alerts.heldAlert(draft, stop.stale!, this.s.now()))
      return
    }
    if (out > 0) {
      // Some story frames already went out; nothing more is posted. Hermes decides what to do with the rest.
      await this.settle(draft, 'failed', null, { note: `Stopped after ${out} of ${draft.publish!.units.length} frames: ${stop.message}` })
      await this.s.alert(alerts.draftKey(draft), alerts.draftTitle(draft), alerts.partialAlert(draft, stop.message, out, this.draftFile(draft.id)))
      return
    }
    const reason: SkipReason = stop.kind === 'rejected' ? { kind: 'rejected' } : { kind: 'late', by: window.deadline }
    await this.skip(draft, reason)
  }

  async advance(draft: Draft, failures: alerts.TickFailures) {
    const now = this.s.now()
    const window = runWindow(draft.format, draft.from)
    if (draft.state === 'rebuilding') {
      // A regenerate that didn't finish. Its approval is already cleared, so nothing can publish from it.
      await this.settle(draft, 'failed', null, { note: 'A regenerate did not finish; run it again.' })
      return this.s.alert(alerts.draftKey(draft), alerts.draftTitle(draft), alerts.rebuildAlert(draft, now))
    }
    if (draft.state === 'previewing' && now >= window.cutoff) {
      await this.settle(draft, 'failed', null, { note: 'The preview never reached Slack before the cutoff.' })
      return this.s.alert(alerts.draftKey(draft), alerts.draftTitle(draft), alerts.previewExpired(draft, now, failures.last(draft.id)))
    }
    if (draft.state === 'previewing') await this.sendPreview(draft)
    if (draft.state === 'previewed') {
      const reactions = readReactions(await this.s.slackReactions(draft.slack.ts!))
      if (reactions.approved && !draft.approvedSeenAt) { draft.approvedSeenAt = now.toISOString(); this.save(draft) }
      const decision = decide(window, reactions, draft.approvedSeenAt ? new Date(draft.approvedSeenAt) : null, this.s.config().auto[draft.format], now)
      if (decision.action === 'skip') return this.skip(draft, decision.reason)
      if (decision.action === 'wait') return
    }
    if (draft.state !== 'previewed' && draft.state !== 'publishing') return
    let done: boolean
    try {
      done = await this.publishDraft(draft, window)
    } catch (error) {
      if (error instanceof PublishStop) return this.stopped(draft, error, window)
      if (error instanceof StillProcessing) { this.s.log(`${draft.id}: ${error.message}`); return }
      draft.publishFailures++
      draft.note = error instanceof Error ? error.message : String(error)
      const pending = draft.publish?.units.some(unit => unit.pendingSince) ?? false
      if (draft.publishFailures >= MAX_PUBLISH_FAILURES && !pending) draft.state = 'failed'
      this.save(draft)
      failures.recordPublish(draft, error, this.draftFile(draft.id))
      return
    }
    if (done) await this.s.resolveAlert(alerts.draftKey(draft), alerts.publishRecovered(draft, this.s.now()))
    else if (now >= window.deadline && draft.state === 'previewed') {
      await this.settle(draft, 'failed', null, { note: 'Not published: the Instagram token or the R2 setup was missing.' })
    }
  }

  /** Remove local frames of settled drafts after 14 days; the state files stay. */
  private prune() {
    for (const draft of this.allDrafts()) {
      if (SETTLED.includes(draft.state) && !draft.notify && this.s.now().getTime() - Date.parse(draft.updatedAt) > 14 * 86_400_000) {
        rmSync(this.framesDir(draft.id), { recursive: true, force: true })
      }
    }
  }

  async tick() {
    const now = this.s.now()
    const token = await this.s.loadToken(now).catch(error => ({ state: 'ok' as const, warning: (error as Error).message }))
    if (token.state === 'ok' && token.warning) await this.s.alert('token', 'Instagram token needs attention', alerts.tokenAlert(token.warning, now), token.warning)
    else if (token.state === 'ok') await this.s.resolveAlert('token', alerts.tokenRecovered(now))
    const failures = new alerts.TickFailures(this.s)
    const attempted = new Set<string>()
    for (const format of Object.keys(FORMATS) as FormatKey[]) {
      for (const from of activeRuns(format, now)) {
        const id = draftId(format, from)
        if (this.loadDraft(id)) continue
        attempted.add(id)
        try { await this.createDraft(format, from, [], 1) } catch (error) {
          // Advance retries a saved preview this tick. Only an unsuccessful retry counts toward the streak.
          if (this.loadDraft(id)?.state === 'previewing') this.s.log(`${id}: ${error instanceof Error ? error.message : String(error)}`)
          else failures.record({ id, format, from }, false, error)
        }
      }
    }
    for (const draft of this.allDrafts()) {
      try {
        // Creation already tried any skip notice, but a pending preview gets another chance.
        if (draft.notify && !attempted.has(draft.id)) await this.deliver(draft)
        if (!SETTLED.includes(draft.state)) await this.advance(draft, failures)
      } catch (error) {
        failures.record(draft, Boolean(draft.slack.ts), error)
      }
    }
    this.prune()
    // Exit 0 for handled failures; notify-failure reports crashes the tick couldn't catch.
    await failures.report(id => this.loadDraft(id))
  }

  async regenerate(id: string, excludeIds: string[], trackId: string | null = null): Promise<Draft> {
    const { format, from } = parseDraftId(id)
    const old = this.loadDraft(id)
    if (!old) throw new Error(`No draft ${id}; see \`status\``)
    if (old.publish || ['publishing', 'published'].includes(old.state)) throw new Error(`${id} has started publishing; it can't be rebuilt`)
    if (this.s.now() >= runWindow(format, from).cutoff) throw new Error(`${id} is past its cutoff`)
    const exclude = [...new Set([...old.exclude, ...excludeIds])]
    const revision = (old.revision ?? 1) + 1
    // Approval is cleared and saved before any frame is touched, so a crash can't leave old approval on new frames.
    if (trackId && format !== 'reel') throw new Error('--track only applies to a Reel')
    // A Reel keeps its track unless --track names another (a skipped draft never got one, so it is chosen again).
    const track = format === 'reel' ? trackId ?? old.track?.id ?? this.chooseTrack() : null
    const ready = track ? readyTrack(this.s.config().reel.musicDir, track) : null
    // The requested track is saved with the rebuilding state, so a crash's recovery command restores it.
    const savedTrack = ready ? { id: ready.id, title: ready.title, artist: ready.artist, credit: ready.credit } : old.track
    this.save({ ...old, revision, state: 'rebuilding', exclude, track: savedTrack, approvedSeenAt: null, slack: { fileIds: [], ts: null }, notify: null, r2Uploaded: null })
    const draft = await this.createDraft(format, from, exclude, revision, track)
    if (draft.state === 'skipped') throw new Error(`Without ${exclude.join(', ')} only ${draft.events.length} events qualify; the draft is skipped`)
    return draft
  }
}

// CLI entry points

export async function dryRun(format: FormatKey, from: string, outDir: string, trackId: string | null = null) {
  const job = new Job(liveServices())
  const work = join(outDir, '.render')
  const track = format === 'reel' ? trackId ?? job.chooseTrack() : null
  const built = await job.build(format, from, [], work, track)
  mkdirSync(outDir, { recursive: true })
  const summary = built.events.map(event => `${event.id}  ${event.date} ${event.time}  ${event.title} · ${event.venue} (${event.barrio})${event.handle ? ` ${footerHandle(event)}` : ''}${event.price ? ` · ${event.price}` : ''}`)
  writeFileSync(join(outDir, 'events.txt'), `${summary.join('\n')}\n`)
  if (!built.frames) {
    const text = tooFewText(format, built.window, built.events.length)
    writeFileSync(join(outDir, 'slack.txt'), `${text}\n`)
    rmSync(work, { recursive: true, force: true })
    console.log(text)
    return
  }
  const names = format === 'reel' ? ['reel.mp4', 'cover.jpg'] : built.frames.map((_, index) => `${format === 'hoy' ? 'frame' : 'slide'}-${index + 1}.jpg`)
  built.frames.forEach((path, index) => copyFileSync(path, join(outDir, names[index]!)))
  if (built.timing) writeFileSync(join(outDir, 'timing.json'), `${JSON.stringify({ track: built.track!.id, ...built.timing }, null, 2)}\n`)
  rmSync(work, { recursive: true, force: true })
  writeFileSync(join(outDir, 'caption.txt'), `${built.caption ?? 'Stories have no caption.'}\n`)
  writeFileSync(join(outDir, 'slack.txt'), `${slackPreview(format, built.window, built.caption, runtime.readConfig().auto[format], built.track ?? undefined)}\n`)
  if (built.track) console.log(`Track: ${built.track.id} ("${built.track.title}" by ${built.track.artist}), ${built.timing!.total} s at ${built.timing!.bpm} BPM`)
  console.log(`${names.join(', ')} and the caption written to ${outDir}`)
}

export const tick = () => runtime.withLock(() => new Job(liveServices()).tick())

export async function regenerate(id: string, excludeIds: string[], trackId: string | null = null) {
  await runtime.withLock(async () => {
    const draft = await new Job(liveServices()).regenerate(id, excludeIds, trackId)
    console.log(`${draft.id}: revision ${draft.revision} with ${draft.events.length} events, previewed again (${draft.slack.ts})`)
  })
}

export function status() {
  const drafts = new Job(liveServices()).allDrafts().sort((a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id))
  if (!drafts.length) { console.log('No drafts yet.'); return }
  const fmt = (date: Date) => date.toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 16)
  for (const draft of drafts) {
    const window = runWindow(draft.format, draft.from)
    const extra = draft.state === 'published' ? draft.publish?.permalink : draft.skipReason ?? draft.note
    console.log([draft.id.padEnd(18), `r${draft.revision ?? 1}`, draft.state.padEnd(10), `draft ${fmt(window.draftAt)}`, `publish ${fmt(window.publishAt)}`,
      `deadline ${fmt(window.deadline)}`, `${draft.events.length} events`, draft.notify ? 'Slack reply pending' : '', extra ?? ''].join('  ').trimEnd())
  }
}

/**
 * The tick, dry-run, regenerate, and status commands. One JSON state file per draft under <state>/drafts.
 *
 * A draft moves previewing → previewed → publishing → published | skipped | failed | held. Every Instagram write
 * re-checks Hanif's current reactions and the deadline (`beforeWrite`). The Slack reply that reports the outcome is a
 * separate pending step (`notify`), saved with the outcome and retried by later ticks until Slack takes it.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FixReceipt } from './catalog-fix.ts'
import { PublishStop, checkWrite, decide, readReactions } from './approval.ts'
import * as alerts from './alerts.ts'
import { fetchArtwork, type Artwork } from './artwork.ts'
import { caption as captionFor, footerHandle, heldText, postedText, skippedMentionsText, skipText, slackPreview, tooFewText, type SkipReason } from './copy.ts'
import { baLocal } from './format.ts'
import { FORMATS, activeRuns, draftId, parseDraftId, runWindow, type FormatKey, type RunWindow } from './formats.ts'
import { FRAME, LAYOUT_VERSION, framesHtml } from './html.ts'
import { PROFILE_URL, StillProcessing, emptyPublishState, eventFrameTag, instagramApi, publish, type InstagramApi, type PublishJob, type PublishState, type Slide } from './instagram.ts'
import { askAll, endTime, flagged, hasCompleted, location, MAX_INVESTIGATIONS, readFindings, requestMatches, type Investigation, type InvestigationRequest } from './investigation.ts'
import { fixLog, investigatorRunning, startInvestigator, stopInvestigator } from './investigator-run.ts'
import { nextTrack, readTracks, readyTrack, type DraftTrack, type ReadyTrack } from './reel/music.ts'
import { reelTiming, type ReelTiming } from './reel/project.ts'
import { allOk, copyHash, validateReview, type ReviewInput, type ReviewResult, type ReviewState, type Reviewer } from './review.ts'
import * as runtime from './runtime.ts'
import type { Config, EventNow, TokenCheck } from './runtime.ts'
import { selectEvents, type CatalogEvent, type PostEvent } from './select.ts'
import { confirmsStory, liveStories, stickerFrames, StoryComposerError, type ComposeStory, type StickerFailure, type StoryShareAttempt } from './story-stickers.ts'
import { threadsApi, type ThreadsApi } from './threads-api.ts'
import { isThreadsFormat, threadsPreview, threadsPreviousRevision, threadsText, threadsWindow } from './threads-copy.ts'
import { advanceThreads, newThreadsDraft, retainThreads, stopThreads, type ThreadsDraft } from './threads-publish.ts'
import { loadThreadsToken, type ThreadsTokenCheck } from './threads-token.ts'

export type DraftState = 'previewing' | 'previewed' | 'publishing' | 'published' | 'skipped' | 'failed' | 'held' | 'rebuilding'

export interface Draft {
  id: string
  format: FormatKey
  from: string
  to: string
  /** Bumped by every regenerate; frames live in their own rev-<n> directory and approval belongs to one revision. */
  revision: number
  /**
   * The layout version (html.ts) this revision's frames were rendered with: where its stickers, mention, and tags go.
   * A draft built before layout versions has none and keeps the earlier positions. Frames are never re-rendered in place.
   */
  layout?: number
  state: DraftState
  exclude: string[]
  events: PostEvent[]
  caption: string | null
  /** Rendered files: the frames, or for a Reel the MP4 and its cover image. */
  frames: string[]
  /** Reel only: the track this draft uses (kept by regenerate unless --track picks another). */
  track?: DraftTrack | null
  framesHash: string
  /** Missing only on previews that predate review. */
  review?: ReviewState
  reviewHistory?: ReviewResult[]
  reviewRebuilds?: { day: string; count: number }
  pendingReviewFixes?: ReturnType<typeof alerts.reviewFix>[]
  investigationCount?: number
  catalogFixes?: FixReceipt[]
  /** Auto mode shown on this Instagram revision; absent on older drafts means manual. */
  slack: { fileIds: string[]; ts: string | null; auto?: boolean }
  approvedSeenAt: string | null
  r2Uploaded: string | null
  publish: PublishState | null
  /** Present only when a new preview was built with Threads enabled. It owns its own outcome and Slack reply. */
  threads?: ThreadsDraft
  /** Saved before the Business Suite Share click. Its presence permanently forbids another write. */
  storyShare?: StoryShareAttempt
  /** A pre-Share browser failure fixes this draft on the Graph route, including retries. */
  stickerFallback?: StickerFailure
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
  /** Download and prepare the events' flyers into `dir`. An event whose flyer fails is left out; only a broken setup (no `sharp`) throws. */
  artwork(events: PostEvent[], dir: string): Promise<Artwork>
  render(html: string, outDir: string, height: number): Promise<string[]>
  /** Returns [reel.mp4, cover.jpg]. */
  renderReel(window: RunWindow, events: PostEvent[], timing: ReelTiming, track: ReadyTrack, outDir: string, artwork: Artwork): Promise<string[]>
  review: Reviewer
  investigator?: { start: typeof startInvestigator; running: typeof investigatorRunning; stop?: typeof stopInvestigator }
  reviewPush(body: string): Promise<void>
  slackUploadFiles(frames: string[], draftId: string): Promise<Array<{ id: string; title: string }>>
  slackShareFiles(files: Array<{ id: string; title: string }>, text: string): Promise<unknown>
  slackShareTs(fileId: string): Promise<string | null>
  slackPost(text: string, threadTs?: string): Promise<{ ts: string }>
  slackReactions(ts: string): Promise<Array<{ name: string; users?: string[] }> | undefined>
  r2Put(bucket: string, key: string, path: string): Promise<void>
  loadToken(now: Date): Promise<TokenCheck>
  instagram(accessToken: string): InstagramApi
  loadThreadsToken(now: Date): Promise<ThreadsTokenCheck>
  threads(accessToken: string): Promise<ThreadsApi>
  composeStory: ComposeStory
  alert(key: string, title: string, text: string, fingerprint?: string, timeoutMs?: number): Promise<boolean>
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
  artwork: (events, dir) => fetchArtwork(events, dir, runtime.log),
  render: (html, outDir, height) => runtime.renderFrames(html, outDir, height),
  renderReel: (window, events, timing, track, outDir, artwork) => runtime.renderReel(window, events, timing, track, outDir, artwork),
  review: runtime.reviewDraft,
  investigator: { start: startInvestigator, running: investigatorRunning, stop: stopInvestigator },
  reviewPush: runtime.reviewPush,
  slackUploadFiles: runtime.slackUploadFiles,
  slackShareFiles: runtime.slackShareFiles,
  slackShareTs: runtime.slackShareTs,
  slackPost: runtime.slackPost,
  slackReactions: runtime.slackReactions,
  r2Put: runtime.r2Put,
  loadToken: now => runtime.loadToken(now),
  instagram: token => instagramApi(token),
  loadThreadsToken,
  threads: token => threadsApi(token),
  composeStory: async (...args) => (await import('./story-composer.ts')).composeStory(...args),
  alert: (key, title, text, fingerprint, timeoutMs) => runtime.alert(key, title, text, fingerprint, undefined, timeoutMs),
  resolveAlert: runtime.resolveAlert,
  sleep: runtime.sleep,
  log: runtime.log,
})

const MAX_PUBLISH_FAILURES = 6
const MAX_REVIEW_REBUILDS = 2
const REVIEW_ALERT_LEAD_MS = 30 * 60_000
/** States a tick no longer advances (a pending notification is still delivered). */
const SETTLED: DraftState[] = ['published', 'skipped', 'failed', 'held']

type ReviewContext = Pick<Draft, 'reviewHistory' | 'reviewRebuilds' | 'pendingReviewFixes' | 'investigationCount' | 'catalogFixes'>

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
    return { fontsDir: join(this.s.repo, 'src/features/instagram-publisher/assets/fonts'), logo: join(this.s.repo, 'static/logo.svg') }
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
    // The flyers go next to the render directory (rendering empties its own) and are removed once the frames exist.
    const artDir = `${outDir}-art`
    try {
      if (format === 'reel') {
        const track = readyTrack(this.s.config().reel.musicDir, trackId!)
        const timing = reelTiming(window, events, track.bpm)
        const frames = await this.s.renderReel(window, events, timing, track, outDir, await this.s.artwork(events, artDir))
        const saved: DraftTrack = { id: track.id, title: track.title, artist: track.artist, credit: track.credit }
        return { window, events, caption: captionFor(format, window, events, track.credit), frames, track: saved, timing }
      }
      const html = framesHtml(format, window, events, this.assets(), await this.s.artwork(events, artDir))
      const frames = await this.s.render(html, outDir, FRAME[FORMATS[format].kind as 'story' | 'carousel'].height)
      return { window, events, caption: captionFor(format, window, events), frames, track: null, timing: null }
    } finally {
      rmSync(artDir, { recursive: true, force: true })
    }
  }

  // Drafting and previewing

  /** Build revision `revision` of a draft into its own directory and preview it. Approval always starts empty. */
  async createDraft(format: FormatKey, from: string, exclude: string[], revision: number, trackId: string | null = null,
    threads?: ThreadsDraft, reviewContext?: ReviewContext & { skipThread?: string | null; unavailableAlert?: boolean }): Promise<Draft> {
    const id = draftId(format, from)
    const dir = join(this.framesDir(id), `rev-${revision}`)
    const built = await this.build(format, from, exclude, dir, format === 'reel' ? trackId ?? this.chooseTrack() : null)
    const draft: Draft = {
      id, format, from, to: built.window.to, revision, layout: LAYOUT_VERSION, state: 'previewing', exclude, events: built.events, caption: built.caption, track: built.track,
      frames: built.frames ?? [], framesHash: built.frames ? runtime.fileHash(built.frames) : '', slack: { fileIds: [], ts: null },
      review: { reelHoldMids: built.timing?.cards.slice(1).map(card => card.holdMid), unavailableAlert: reviewContext?.unavailableAlert },
      reviewHistory: reviewContext?.reviewHistory, reviewRebuilds: reviewContext?.reviewRebuilds, pendingReviewFixes: reviewContext?.pendingReviewFixes,
      investigationCount: reviewContext?.investigationCount, catalogFixes: reviewContext?.catalogFixes,
      approvedSeenAt: null, r2Uploaded: null, publish: null, publishFailures: 0, notify: null, skipReason: null, note: null, updatedAt: '', threads,
    }
    if (!built.frames) {
      rmSync(dir, { recursive: true, force: true })
      draft.state = 'skipped'
      draft.skipReason = skipText({ kind: 'too-few', count: built.events.length })
      const skipThread = reviewContext?.skipThread
      draft.notify = skipThread
        ? { text: `${draft.skipReason} after removing events that did not pass review. Nothing new will publish.`, threadTs: skipThread }
        : { text: tooFewText(format, built.window, built.events.length), threadTs: null }
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
      const config = this.s.config()
      const format = draft.format
      draft.review ??= {} // This preview has not been handed to Slack yet.
      draft.slack.auto = config.auto[format]
      let text = slackPreview(format, runWindow(format, draft.from), draft.caption, draft.slack.auto, draft.track ?? undefined)
      if (isThreadsFormat(format)) {
        const window = threadsWindow(format, draft.from)
        const beforeCutoff = this.s.now() < window.cutoff
        if (draft.threads && (retainThreads(draft.threads) || !beforeCutoff)) {
          if (config.threads.enabled && draft.threads.mediaId) text += `\n\n${threadsPreviousRevision}`
        } else if (config.threads.enabled && beforeCutoff) {
          const auto = config.threads.auto[format]
          draft.threads = newThreadsDraft(threadsText(format, draft.events), auto)
          if (draft.threads.text) text += threadsPreview(draft.threads.text, window.publishAt, auto)
        } else delete draft.threads
      }
      if (draft.slack.auto || (this.currentThreads(draft) && draft.threads?.auto)) {
        text += '\n\nLa publicación automática requiere que esta versión pase la revisión.'
      }
      // A Reel's preview attaches the video only.
      const files = await this.s.slackUploadFiles(draft.format === 'reel' ? draft.frames.slice(0, 1) : draft.frames, draft.id)
      // Saved before sharing: if the share's answer is lost, the next tick looks the message up instead of posting again.
      draft.slack.fileIds = files.map(file => file.id)
      this.save(draft)
      await this.s.slackShareFiles(files, text)
      draft.slack.ts = await this.s.slackShareTs(draft.slack.fileIds[0]!)
      if (!draft.slack.ts) throw new Error('Slack preview lookup failed: the upload has no message yet')
    }
    if (draft.threads && !draft.threads.threadTs && draft.slack.ts && !draft.threads.attemptedAt && !draft.threads.mediaId) {
      draft.threads.threadTs = draft.slack.ts
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

  async previewStickers(id: string, outDir: string) {
    if (parseDraftId(id).format !== 'hoy') throw new Error('Sticker previews are only available for Hoy drafts.')
    const draft = this.loadDraft(id)
    if (!draft || draft.format !== 'hoy') throw new Error(`No Hoy draft ${id}; see \`status\``)
    this.verifyFrames(draft)
    return this.s.composeStory(stickerFrames(draft.frames, draft.events, draft.layout), { previewDir: outDir })
  }

  // Review: the result belongs to one preview, not just the draft ID.

  private currentThreads(draft: Draft) {
    return draft.threads && (!draft.threads.threadTs || draft.threads.threadTs === draft.slack.ts) ? draft.threads : undefined
  }

  private reviewInput(draft: Draft): ReviewInput {
    return { format: draft.format, from: draft.from, to: draft.to, caption: draft.caption,
      threads: this.currentThreads(draft)?.text ?? null, events: draft.events, frames: draft.frames, reelHoldMids: draft.review?.reelHoldMids }
  }

  private matchingReview(draft: Draft) {
    const result = draft.review?.result
    const input = this.reviewInput(draft)
    if (result?.revision !== draft.revision || result.framesHash !== draft.framesHash || result.copyHash !== copyHash(input)) return undefined
    try { this.verifyFrames(draft); return validateReview(input, result) } catch { return undefined }
  }

  private reviewAllowsAuto(draft: Draft) {
    if (!draft.review) return true // Grandfather a preview sent on the previous version of the publisher.
    const result = this.matchingReview(draft)
    if (!result) return false
    if (allOk(result)) return true
    const investigation = draft.review.investigation
    return result.post.verdict === 'ok' && Boolean(investigation?.findings && !investigation.failure
      && requestMatches(investigation.request, draft, this.reviewInput(draft))
      && flagged(result).every(event => investigation.findings?.[event.id]?.verdict === 'ok'))
  }

  private async runReview(draft: Draft): Promise<ReviewResult> {
    this.verifyFrames(draft)
    const input = this.reviewInput(draft)
    const startedAt = this.s.now().toISOString()
    const result = validateReview(input, await this.s.review(input))
    this.verifyFrames(draft)
    return { ...result, revision: draft.revision, framesHash: draft.framesHash, copyHash: copyHash(input), startedAt, completedAt: this.s.now().toISOString() }
  }

  async review(id: string) {
    parseDraftId(id)
    const draft = this.loadDraft(id)
    if (!draft?.slack.ts || !draft.frames.length) throw new Error(`No rendered preview for ${id}; see \`status\`.`)
    return this.runReview(draft)
  }

  private async advanceReview(draft: Draft, window: RunWindow): Promise<Draft | undefined> {
    const review = draft.review
    const ts = draft.slack.ts
    if (!review || !ts) return
    const now = this.s.now()
    const thread = this.currentThreads(draft)
    const threadWindow = isThreadsFormat(draft.format) && thread && this.s.config().threads.enabled && !retainThreads(thread)
      && (thread.state === 'waiting' || thread.state === 'publishing') ? threadsWindow(draft.format, draft.from) : null
    const instagramOpen = ['previewed', 'publishing'].includes(draft.state) && now < window.deadline
    const threadsOpen = threadWindow && now < threadWindow.cutoff
    const open = instagramOpen || threadsOpen
    const pendingInvestigation = review.investigation && (!review.investigation.findings || (review.investigation.failure && !review.investigation.failureAlerted))
    if (!open && !pendingInvestigation && (!review.result || (review.replied && !review.unavailableAlert))) return
    const reactions = async () => readReactions(await this.s.slackReactions(ts))
    let result = this.matchingReview(draft)
    if (!result && open && !(await reactions()).rejected) {
      try {
        if (review.result) throw new Error('The saved review no longer matches this preview. Regenerate the draft.')
        result = await this.runReview(draft)
      } catch (error) {
        const failure = alerts.describeFailure(error).message
        this.s.log(`${draft.id}: review failed: ${failure}`)
        const slot = threadsOpen && (!instagramOpen || threadWindow.publishAt < window.publishAt) ? threadWindow.publishAt : window.publishAt
        if (!review.unavailableAlert && this.s.now().getTime() >= slot.getTime() - REVIEW_ALERT_LEAD_MS) {
          await this.reviewAction(draft, 'unavailable alert', async () => {
            review.unavailableAlert = await this.s.alert(`${alerts.draftKey(draft)}/review`, alerts.draftTitle(draft),
              alerts.reviewUnavailable(draft, slot, this.s.now(), error), `revision ${draft.revision}`, 20_000)
            if (review.unavailableAlert) this.save(draft)
          })
        }
        return
      }
      draft.review = { reelHoldMids: review.reelHoldMids, result, unavailableAlert: review.unavailableAlert, investigatorEnabled: Boolean(this.s.investigator) }
      const fixes = (draft.review.investigatorEnabled ? [] : result.events.filter(event => event.verdict === 'wrong'))
        .map(event => alerts.reviewFix(draft, event.id, event))
      if (result.post.verdict === 'wrong') fixes.push(alerts.reviewFix(draft, null, result.post))
      if (fixes.length) draft.pendingReviewFixes = [...(draft.pendingReviewFixes ?? []), ...fixes]
      this.save(draft)
    }
    if (!result) return
    const state = draft.review!
    if (state.unavailableAlert) await this.reviewAction(draft, 'resolve alert', async () => {
      if (await this.s.resolveAlert(`${alerts.draftKey(draft)}/review`, `✅ Review completed for ${draft.id} r${draft.revision}.`) !== false) {
        delete state.unavailableAlert
        this.save(draft)
      }
    })
    if (state.investigatorEnabled && flagged(result).length) return this.advanceInvestigation(draft, result, window, threadWindow, open)
    const wrong = result.events.filter(event => event.verdict === 'wrong')
    const hasError = wrong.length > 0 || result.post.verdict === 'wrong'
    if (wrong.length && draft.state === 'previewed' && !draft.publish && !draft.storyShare && this.s.now() < window.cutoff) {
      const { approved, rejected } = await reactions()
      const day = baLocal(this.s.now()).date
      if (!approved && !rejected && this.s.now() < window.cutoff
        && (draft.reviewRebuilds?.day !== day || draft.reviewRebuilds.count < MAX_REVIEW_REBUILDS)) {
        return this.regenerate(draft.id, wrong.map(event => event.id), null, { day, count: draft.reviewRebuilds?.day === day ? draft.reviewRebuilds.count + 1 : 1 })
      }
    }
    const eventName = (id: string) => draft.events.find(event => event.id === id)!.title
    const questions = result.events.flatMap(event => event.question ? [`${eventName(event.id)}: ${event.question}`] : [])
    if (result.post.question) questions.push(result.post.question)
    if (!state.replied) await this.reviewAction(draft, 'Slack reply', async () => {
      const questionText = questions.length ? `\nRespondé con ✅ o ❌ en la vista previa.\n${questions.map(alerts.slackLiteral).join('\n')}` : ''
      const message = allOk(result) ? 'Revisado: sin problemas.' : hasError
        ? `Revisión: se detectó un error. Esta versión no se publicará automáticamente.${questionText}`
        : `Revisión: hace falta tu decisión.${questionText}`
      await this.s.slackPost(message, ts)
      state.replied = true
      this.save(draft)
    })
    if (questions.length && !state.homeAttempted && ((instagramOpen && this.s.now() < window.cutoff)
      || (threadWindow && this.s.now() < threadWindow.cutoff))) {
      const { approved, rejected } = await reactions()
      if (approved || rejected) return
      // Home has no verified decision readback here. Reserve the push once; a lost response must not ping Hanif twice.
      state.homeAttempted = true
      this.save(draft)
      const link = `https://app.slack.com/archives/${runtime.SLACK_CHANNEL}/p${ts.replace('.', '')}`
      await this.reviewAction(draft, 'Home push', () => this.s.reviewPush([
        draft.id, ...(hasError ? ['This version also has a confirmed issue and will not publish automatically.'] : []), ...questions,
        '', 'Publicar: react ✅ on the Slack preview to approve this version. No publicar: react ❌ to skip both posts.',
        `The publisher reads only the Slack reactions. Slack preview: ${link}`,
      ].join('\n')))
    }
  }

  private investigationPlan(draft: Draft, result: ReviewResult, window: RunWindow, threadWindow?: ReturnType<typeof threadsWindow> | null) {
    const now = this.s.now()
    const other = threadWindow && now < threadWindow.cutoff ? threadWindow : null
    const cutoff = other && other.cutoff < window.cutoff ? other.cutoff : window.cutoff
    const slot = other && other.publishAt < window.publishAt ? other.publishAt : window.publishAt
    const input = this.reviewInput(draft)
    const request: InvestigationRequest = { id: draft.id, revision: draft.revision, framesHash: draft.framesHash, copyHash: copyHash(input),
      startsAt: now.getTime(), endsAt: endTime(now.getTime(), cutoff), cutoff: cutoff.toISOString(), slot: slot.toISOString(),
      input, events: flagged(result).map(event => ({ ...event, title: input.events.find(item => item.id === event.id)!.title })) }
    const round = (draft.investigationCount ?? 0) + 1
    const why = round > MAX_INVESTIGATIONS ? 'Two revisions have already been investigated.'
      : request.endsAt <= request.startsAt ? 'There is no investigation time left before cutoff.'
        : draft.state !== 'previewed' || draft.publish || draft.storyShare || draft.approvedSeenAt ? 'The draft is no longer open for corrections.' : null
    return { request, round, why, dir: location(this.s.stateDir, request) }
  }

  private async queueInvestigation(draft: Draft, { request, round, why, dir }: ReturnType<Job['investigationPlan']>) {
    const investigation: Investigation = { request, round }
    draft.review!.investigation = investigation
    if (why) investigation.findings = askAll(request.events, why)
    else draft.investigationCount = round
    // Reserve before launching: a crash during handoff cannot start the revision a second time.
    this.save(draft)
    if (why) return investigation
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      runtime.writeJson(join(dir, 'request.json'), request)
      if (!this.s.investigator) throw new Error('No investigator service.')
      await this.s.investigator.start(request, dir)
    } catch {
      this.failInvestigation(draft, investigation, 'The investigator could not start.')
    }
    return investigation
  }

  async investigate(id: string, dryRun: boolean) {
    parseDraftId(id)
    const draft = this.loadDraft(id)
    const result = draft && this.matchingReview(draft)
    if (!draft?.slack.ts || !result || !flagged(result).length) throw new Error('No matching quick review with flagged events.')
    const current = this.currentThreads(draft)
    const thread = this.s.config().threads.enabled && isThreadsFormat(draft.format) && current && !retainThreads(current)
      ? threadsWindow(draft.format, draft.from) : null
    const plan = this.investigationPlan(draft, result, runWindow(draft.format, draft.from), thread)
    if (draft.review?.investigation) return { existing: true, ...draft.review.investigation }
    if (dryRun) return plan
    if (plan.why) throw new Error(plan.why)
    const { approved, rejected } = readReactions(await this.s.slackReactions(draft.slack.ts))
    if (approved || rejected) throw new Error('Hanif already decided on this preview.')
    draft.review!.investigatorEnabled = true
    return this.queueInvestigation(draft, plan)
  }

  private failInvestigation(draft: Draft, investigation: Investigation, reason: string) {
    investigation.failure = reason
    investigation.findings = askAll(investigation.request.events, reason)
    this.s.log(`${draft.id} r${draft.revision}: ${reason}`)
    this.save(draft)
  }

  private collectCatalogFixes(draft: Draft) {
    if (!draft.investigationCount) return
    const root = this.framesDir(draft.id)
    if (!existsSync(root)) return
    const known = new Set(draft.catalogFixes?.map(fix => fix.operation))
    for (const name of readdirSync(root).filter(name => /^investigation-\d+$/u.test(name))) {
      try {
        for (const fix of fixLog(join(root, name)).applied) {
          if (known.has(fix.operation)) continue
          known.add(fix.operation)
          draft.catalogFixes = [...(draft.catalogFixes ?? []), fix]
          this.save(draft)
        }
      } catch { this.s.log(`${draft.id}: could not read the investigation fix log.`) }
    }
  }

  private async stopInvestigation(draft: Draft, by: 'reaction' | 'rebuild') {
    const investigation = draft.review?.investigation
    if (!investigation || investigation.findings) return
    runtime.writeJson(join(location(this.s.stateDir, investigation.request), 'stopped'), { by })
    await this.s.investigator?.stop?.(investigation.request).catch(() => undefined)
  }

  private async advanceInvestigation(draft: Draft, result: ReviewResult, window: RunWindow,
    threadWindow: ReturnType<typeof threadsWindow> | null, open: boolean | null): Promise<Draft | undefined> {
    const state = draft.review!
    const ts = draft.slack.ts!
    const reactions = async () => readReactions(await this.s.slackReactions(ts))
    let investigation = state.investigation
    // A terminal failure alert must still be delivered if Hanif reacted or the cutoff has passed.
    const alertFailure = async (item: Investigation) => {
      if (item.failure && !item.failureAlerted) await this.reviewAction(draft, 'investigator alert', async () => {
        item.failureAlerted = await this.s.alert('investigator', 'Publisher investigation needs Hermes',
          alerts.investigatorFailed(draft, item.failure!, location(this.s.stateDir, item.request)), `${draft.id} r${draft.revision}: ${item.failure}`, 20_000)
        if (item.failureAlerted) this.save(draft)
      })
    }
    if (investigation) await alertFailure(investigation)
    const { approved, rejected } = await reactions()
    const overridden = approved || rejected
    if (overridden && (!investigation || (!investigation.findings && !hasCompleted(location(this.s.stateDir, investigation.request))))) {
      if (investigation) {
        await this.stopInvestigation(draft, 'reaction')
        investigation.findings = askAll(investigation.request.events, 'A Slack reaction stopped the investigation.')
      }
      if (!open) state.replied = true // Do not poll reactions on a settled preview with no finished investigation to report.
      if (investigation || !open) this.save(draft)
      return
    }
    if (!investigation) {
      if (!open) return
      investigation = await this.queueInvestigation(draft, this.investigationPlan(draft, result, window, threadWindow))
      if (!investigation.findings) return
    }
    const { request } = investigation
    if (!requestMatches(request, draft, this.reviewInput(draft))) return
    const dir = location(this.s.stateDir, request)
    if (!investigation.findings) {
      const read = () => readFindings(dir, request, this.s.now().getTime())
      let findings = read()
      if (!findings && !hasCompleted(dir) && this.s.now().getTime() < request.endsAt) {
        if (await this.s.investigator?.running(request).catch(() => false)) return
        findings = read() // The unit may have completed while systemctl was checking it.
      }
      try {
        const { applied, uncertain } = fixLog(dir)
        if (uncertain) this.failInvestigation(draft, investigation, 'A catalog correction has no D1 acknowledgement; check the fix log.')
        else if (findings && request.events.every(({ id }) => {
          const item = findings[id]!
          const fixes = applied.filter(fix => fix.id === id)
          if (item.verdict === 'fixed') return item.fixes.length === fixes.length && fixes.every(fix => item.fixes.includes(fix.operation))
          return item.verdict === 'ask' || !fixes.length
        })) {
          investigation.findings = findings
          for (const [id, item] of Object.entries(findings)) if (item.verdict === 'ask' && item.hermes) {
            const fix = alerts.reviewFix(draft, id, { verdict: 'wrong', field: 'investigator', reason: item.hermes, question: null })
            draft.pendingReviewFixes = [...(draft.pendingReviewFixes ?? []), fix]
          }
          this.collectCatalogFixes(draft)
          this.save(draft)
        } else this.failInvestigation(draft, investigation, 'The investigator stopped without complete, valid, on-time findings.')
      } catch { this.failInvestigation(draft, investigation, 'The investigator fix log could not be read.') }
    }
    await alertFailure(investigation)
    const findings = investigation.findings!
    const exclusions = request.events.filter(({ id }) => findings[id]?.verdict === 'exclude').map(({ id }) => id)
    const repair = exclusions.length > 0 || Object.values(findings).some(item => item.verdict === 'fixed')
    const day = baLocal(this.s.now()).date
    const count = draft.reviewRebuilds?.day === day ? draft.reviewRebuilds.count : 0
    const canRebuild = !overridden && draft.state === 'previewed' && !draft.publish && !draft.storyShare && this.s.now() < window.cutoff && count < MAX_REVIEW_REBUILDS
    const questions = overridden ? [] : request.events.flatMap(({ id, title }) => {
      const item = findings[id]!
      if (item.verdict === 'ask') return [{ text: `${title}: ${item.question} Checked: ${item.checked}`, push: !item.hermes && !investigation.failure }]
      if (repair && !canRebuild && item.verdict !== 'ok') return [{
        text: `${title}: This preview still shows the old information and cannot be rebuilt automatically. Approve this version?`, push: true,
      }]
      return []
    })
    const fieldLabel = { description_display_es: 'Spanish description', description_display_en: 'English description',
      description_summary_es: 'Spanish summary', description_summary_en: 'English summary', name: 'title', starts_at: 'start time',
      price: 'price', is_free: 'free admission', status: 'status' } as const
    const lines = request.events.map(({ id, title }) => {
      const item = findings[id]!
      const detail = item.verdict === 'ok' ? `${item.reason} (${item.url})` : item.verdict === 'exclude' ? `Exclude: ${item.reason}`
        : item.verdict === 'ask' ? `${item.question} Checked: ${item.checked}`
          : `Corrected ${draft.catalogFixes?.filter(fix => item.fixes.includes(fix.operation)).map(fix => {
            const n = fix.changes.length
            return `${fieldLabel[fix.field]} on ${n} occurrence${n === 1 ? '' : 's'}`
          }).join(', ')}.`
      return alerts.slackLiteral(`${title}: ${detail}`)
    })
    if (result.post.question) {
      lines.push(alerts.slackLiteral(result.post.question))
      if (!overridden) questions.push({ text: result.post.question, push: true })
    }
    if (result.post.verdict === 'wrong') lines.push('The post also has a confirmed issue and cannot publish automatically.')
    if (questions.length) lines.push('Respondé con ✅ o ❌ en la vista previa.')
    if (!investigation.replied) await this.reviewAction(draft, 'investigator Slack reply', async () => {
      await this.s.slackPost(`Revisión: investigación\n${lines.join('\n')}`, ts)
      investigation.replied = true
      state.replied = true
      this.save(draft)
    })
    if (repair && canRebuild && !Object.values(findings).some(item => item.verdict === 'ask') && investigation.replied) {
      const latest = await reactions()
      if (!latest.approved && !latest.rejected && this.s.now() < window.cutoff) {
        return this.regenerate(draft.id, exclusions, null, { day, count: count + 1 })
      }
      return
    }
    const pushQuestions = questions.filter(question => question.push).map(question => question.text)
    if (pushQuestions.length && !state.homeAttempted && open && (this.s.now() < window.cutoff || (threadWindow && this.s.now() < threadWindow.cutoff))) {
      const latest = await reactions()
      if (latest.approved || latest.rejected) return
      state.homeAttempted = true
      this.save(draft)
      const link = `https://app.slack.com/archives/${runtime.SLACK_CHANNEL}/p${ts.replace('.', '')}`
      await this.reviewAction(draft, 'Home push', () => this.s.reviewPush([
        draft.id, ...pushQuestions, '', 'Publicar: react ✅ on the Slack preview to approve this version. No publicar: react ❌ to skip both posts.',
        `The publisher reads only the Slack reactions. Slack preview: ${link}`,
      ].join('\n')))
    }
  }

  private async reviewAction(draft: Draft, action: string, run: () => Promise<void>) {
    try { await run() } catch { this.s.log(`${draft.id}: could not deliver review ${action}`) }
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
    if (reason.kind === 'rejected' && draft.threads && this.s.config().threads.enabled) stopThreads(draft.threads, 'rejected')
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

  private async reconcileStory(draft: Draft, window: RunWindow, poll = false): Promise<boolean> {
    const attempt = draft.storyShare!
    const skippedNote = attempt.skippedMentions?.length ? skippedMentionsText(attempt.skippedMentions) : null
    let failure: string | undefined
    for (let check = 0; check < (poll ? 5 : 1); check++) {
      let confirmed = false
      try {
        const token = await this.s.loadToken(this.s.now())
        if (token.state === 'missing') throw new Error('The Instagram token file is missing.')
        confirmed = confirmsStory(attempt, await liveStories(this.s.instagram(token.token.access_token), token.token.ig_user_id))
      } catch (error) {
        if (this.s.now() < window.deadline) throw error
        failure = alerts.describeFailure(error).message
      }
      if (confirmed) {
        await this.settle(draft, 'published', [postedText(PROFILE_URL), skippedNote].filter(Boolean).join('\n'), { publishFailures: 0, note: skippedNote })
        return true
      }
      if (this.s.now() >= window.deadline) {
        const note = ['Business Suite Share was attempted; check @baeventos.app Stories.', skippedNote].filter(Boolean).join('\n')
        await this.settle(draft, 'held', `Held: ${note}`, { note })
        await this.s.alert(alerts.draftKey(draft), alerts.draftTitle(draft), alerts.storyUnconfirmed(draft, this.s.now(), failure))
        return false
      }
      if (poll && check < 4) await this.s.sleep(15_000)
    }
    this.s.log(`${draft.id}: checking again next tick whether the Story went out; not sharing again`)
    return false
  }

  private recordComposerFailure(draft: Draft, error: StoryComposerError) {
    this.s.log(`${draft.id}: ${error.message}`)
    if (draft.storyShare) {
      if (!error.evidenceDir) return
      draft.storyShare.evidenceDir = error.evidenceDir
    } else {
      draft.stickerFallback = { signIn: error.signIn, step: error.step, evidenceDir: error.evidenceDir }
    }
    this.save(draft)
  }

  private instagramAuto(draft: Draft) {
    return draft.slack.auto === true && this.s.config().auto[draft.format] && this.reviewAllowsAuto(draft)
  }

  /** Returns true only when the draft is published. A pending Business Suite Share takes precedence over all gates. */
  private async publishDraft(draft: Draft, window: RunWindow): Promise<boolean> {
    if (draft.storyShare) return this.reconcileStory(draft, window)
    const config = this.s.config()
    const token = await this.s.loadToken(this.s.now())
    if (token.state === 'missing') { this.s.log(`${draft.id}: no Instagram token file; skipping publishing`); return false }
    if (!config.r2) { this.s.log(`${draft.id}: no R2 bucket in the config; skipping publishing`); return false }
    // Every write re-checks the reactions and the deadline; the first write of each attempt also re-checks the events.
    // Reconciling an earlier unclear publish never calls this, so it isn't blocked by any of these checks.
    let eventsChecked = false
    const beforeWrite = async () => {
      checkWrite(window, readReactions(await this.s.slackReactions(draft.slack.ts!)), this.instagramAuto(draft), this.s.now())
      if (!eventsChecked) { await this.checkEvents(draft); eventsChecked = true }
    }
    if (draft.format === 'hoy' && config.linkStickers.hoy && !draft.publish && !draft.stickerFallback) {
      await beforeWrite()
      this.verifyFrames(draft)
      const frames = stickerFrames(draft.frames, draft.events, draft.layout)
      try {
        await this.s.composeStory(frames, { evidenceDir: this.framesDir(draft.id), beforeShare: async (signal, skippedMentions) => {
          const api = this.s.instagram(token.token.access_token)
          const before = await liveStories(api, token.token.ig_user_id).catch(() => {
            throw new StoryComposerError('read existing Instagram Stories before sharing')
          })
          eventsChecked = false // Editing takes time; use the fresh catalog and Slack decisions just before Share.
          await beforeWrite()
          // If D1 took us across the deadline, do not start a new write.
          const now = this.s.now()
          if (now >= window.deadline) throw new PublishStop('deadline', 'The publishing deadline passed')
          if (signal.aborted) throw new StoryComposerError('finish the Business Suite flow within six minutes')
          draft.storyShare = { at: now.toISOString(), frameCount: frames.length, beforeIds: before.map(story => story.id), skippedMentions }
          draft.state = 'publishing'
          this.save(draft)
        } })
      } catch (error) {
        if (!(error instanceof StoryComposerError)) throw error
        this.recordComposerFailure(draft, error)
      }
      if (draft.storyShare) return this.reconcileStory(draft, window, true)
      if (!draft.stickerFallback) throw new Error('The composer returned without recording a Share attempt.')
      eventsChecked = false // The Graph fallback has its own first-write check.
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
      const slides: Slide[] = draft.frames.map((_, index) => ({ url: url(names[index]!), tag: eventFrameTag(draft.events, index, height, draft.layout) }))
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
      if (draft.threads && this.s.config().threads.enabled) stopThreads(draft.threads, { title })
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

  async advance(draft: Draft, failures: alerts.TickFailures): Promise<boolean | void> {
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
    const rebuilt = await this.advanceReview(draft, window)
    if (rebuilt) return rebuilt.state === 'previewed' ? this.advance(rebuilt, failures) : undefined
    if (draft.state === 'previewed') {
      const reactions = readReactions(await this.s.slackReactions(draft.slack.ts!))
      const checkedAt = this.s.now()
      if (reactions.approved && !draft.approvedSeenAt) { draft.approvedSeenAt = checkedAt.toISOString(); this.save(draft) }
      const decision = decide(window, reactions, draft.approvedSeenAt ? new Date(draft.approvedSeenAt) : null, this.instagramAuto(draft), checkedAt)
      if (decision.action === 'skip') {
        // Hoy's auto window stays open after its approval cutoff. An unavailable review can still recover in that window.
        if (decision.reason.kind === 'no-approval' && checkedAt < window.deadline && draft.review && !this.matchingReview(draft)
          && draft.slack.auto && this.s.config().auto[draft.format]) return
        return this.skip(draft, decision.reason)
      }
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
      const pending = draft.storyShare || draft.publish?.units.some(unit => unit.pendingSince)
      if (draft.publishFailures >= MAX_PUBLISH_FAILURES && !pending) draft.state = 'failed'
      this.save(draft)
      failures.recordPublish(draft, error, this.draftFile(draft.id))
      return
    }
    if (done) {
      await this.s.resolveAlert(alerts.draftKey(draft), alerts.publishRecovered(draft, this.s.now()))
      if (draft.stickerFallback) await this.s.alert(`${alerts.draftKey(draft)}/stickers`, alerts.draftTitle(draft), alerts.stickersFallback(draft, draft.stickerFallback))
    } else if (now >= window.deadline && draft.state === 'previewed') {
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
        this.collectCatalogFixes(draft)
        if (draft.notify && !attempted.has(draft.id)) await this.deliver(draft)
        if (!SETTLED.includes(draft.state)) await this.advance(draft, failures)
        else await this.advanceReview(draft, runWindow(draft.format, draft.from))
      } catch (error) {
        failures.record(draft, Boolean(draft.slack.ts), error)
      }
    }
    await this.tickThreads()
    // Fix alerts are durable across rebuilds and don't delay a safe replacement or a human-approved send.
    for (const draft of this.allDrafts()) {
      if (!draft.pendingReviewFixes?.length) continue
      const pending: NonNullable<Draft['pendingReviewFixes']> = []
      for (const fix of draft.pendingReviewFixes) {
        const sent = await this.s.alert(fix.key, fix.title, fix.text, fix.fingerprint, 20_000).catch(() => false)
        if (!sent) pending.push(fix)
      }
      if (pending.length !== draft.pendingReviewFixes.length) {
        draft.pendingReviewFixes = pending.length ? pending : undefined
        this.save(draft)
      }
    }
    this.prune()
    // Exit 0 for handled failures; notify-failure reports crashes the tick couldn't catch.
    await failures.report(id => this.loadDraft(id))
  }

  private async tickThreads() {
    const enabled = () => this.s.config().threads.enabled
    if (!enabled()) return
    const token = await this.s.loadThreadsToken(this.s.now()).catch(() => ({ accessToken: null, warning: 'Could not check the Threads token.' }))
    let client: Promise<ThreadsApi> | undefined
    const api = () => {
      if (!token.accessToken) throw new Error('No valid Threads token')
      return client ??= this.s.threads(token.accessToken)
    }
    for (const draft of this.allDrafts()) {
      const { threads, format } = draft
      const ts = threads?.threadTs ?? draft.slack.ts
      if (!threads || !ts || !isThreadsFormat(format)) continue
      await advanceThreads(threads, threadsWindow(format, draft.from), {
        api,
        now: () => this.s.now(),
        sleep: ms => this.s.sleep(ms),
        save: () => this.save(draft),
        reactions: () => this.s.slackReactions(ts),
        enabled,
        auto: () => this.s.config().threads.auto[format] && this.currentThreads(draft) === threads && this.reviewAllowsAuto(draft),
        checkEvents: () => this.checkEvents(draft),
        reply: text => this.s.slackPost(text, ts),
        log: text => this.s.log(`${draft.id}: ${text}`),
      }).catch(() => this.s.log(`${draft.id}: could not advance Threads state; see the saved draft`))
      if (threads.state === 'failed' && !threads.failureAlertSent) {
        const alert = alerts.threadsFailed(draft, threads.error, Boolean(threads.attemptedAt && !threads.mediaId), this.draftFile(draft.id))
        try {
          const sent = await this.s.alert(`${alerts.draftKey(draft)}/threads`, alert.title, alert.text, alert.fingerprint)
          if (sent) {
            threads.failureAlertSent = true
            this.save(draft)
          }
        } catch { this.s.log(`${draft.id}: could not raise the Threads failure alert`) }
      }
    }
    // Alerts use the same namespace, but a Threads token issue is never counted as an Instagram failure.
    try {
      if (token.warning) await this.s.alert('threads-token', 'Threads token needs attention', token.warning, token.warning)
      else await this.s.resolveAlert('threads-token')
    } catch { this.s.log('Could not update the Threads token alert') }
  }

  async regenerate(id: string, excludeIds: string[], trackId: string | null = null, reviewRebuilds?: Draft['reviewRebuilds']): Promise<Draft> {
    const { format, from } = parseDraftId(id)
    const old = this.loadDraft(id)
    if (!old) throw new Error(`No draft ${id}; see \`status\``)
    if (old.storyShare || old.publish || ['publishing', 'published'].includes(old.state)) {
      throw new Error(`${id} has started publishing; it can't be rebuilt`)
    }
    const now = this.s.now()
    if (now >= runWindow(format, from).cutoff) throw new Error(`${id} is past its cutoff`)
    const exclude = [...new Set([...old.exclude, ...excludeIds])]
    const revision = (old.revision ?? 1) + 1
    // Approval is cleared and saved before any frame is touched, so a crash can't leave old approval on new frames.
    if (trackId && format !== 'reel') throw new Error('--track only applies to a Reel')
    // A Reel keeps its track unless --track names another (a skipped draft never got one, so it is chosen again).
    const track = format === 'reel' ? trackId ?? old.track?.id ?? this.chooseTrack() : null
    const ready = track ? readyTrack(this.s.config().reel.musicDir, track) : null
    // The requested track is saved with the rebuilding state, so a crash's recovery command restores it.
    const savedTrack = ready ? { id: ready.id, title: ready.title, artist: ready.artist, credit: ready.credit } : old.track
    // A sent, closed, or past-cutoff Threads draft still owns its earlier preview and any outcome or alert.
    const threads = old.threads && isThreadsFormat(format) && (retainThreads(old.threads) || now >= threadsWindow(format, from).cutoff)
      ? { ...old.threads, threadTs: old.threads.threadTs ?? old.slack.ts ?? undefined } : undefined
    await this.stopInvestigation(old, 'rebuild')
    this.collectCatalogFixes(old)
    const reviewHistory = old.review?.result ? [...(old.reviewHistory ?? []), old.review.result] : old.reviewHistory
    const context = { reviewHistory, reviewRebuilds: reviewRebuilds ?? old.reviewRebuilds, pendingReviewFixes: old.pendingReviewFixes,
      investigationCount: old.investigationCount, catalogFixes: old.catalogFixes }
    const unavailableAlert = old.review?.unavailableAlert
    this.save({ ...old, ...context, review: { unavailableAlert }, revision, state: 'rebuilding', exclude, track: savedTrack,
      approvedSeenAt: null, slack: { fileIds: [], ts: null }, notify: null, r2Uploaded: null, threads })
    const draft = await this.createDraft(format, from, exclude, revision, track, threads, { ...context, unavailableAlert, skipThread: reviewRebuilds && old.slack.ts })
    if (draft.state === 'skipped' && !reviewRebuilds) throw new Error(`Without ${exclude.join(', ')} only ${draft.events.length} events qualify; the draft is skipped`)
    return draft
  }
}

// CLI entry points

export async function dryRun(format: FormatKey, from: string, outDir: string, { trackId = null, threads = false, job = new Job(liveServices()) }: {
  trackId?: string | null; threads?: boolean; job?: Job
} = {}) {
  const work = join(outDir, '.render')
  const track = format === 'reel' ? trackId ?? job.chooseTrack() : null
  const built = await job.build(format, from, [], work, track)
  mkdirSync(outDir, { recursive: true })
  const threadsFile = join(outDir, 'threads.txt')
  rmSync(threadsFile, { force: true })
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
  const config = job.s.config()
  let preview = slackPreview(format, built.window, built.caption, config.auto[format], built.track ?? undefined)
  if ((config.threads.enabled || threads) && isThreadsFormat(format)) {
    const text = threadsText(format, built.events)
    if (!text) console.log('No Threads text: the minimum event list does not fit in 500 characters.')
    else {
      writeFileSync(threadsFile, text)
      preview += threadsPreview(text, threadsWindow(format, from).publishAt, config.threads.auto[format])
    }
  }
  writeFileSync(join(outDir, 'slack.txt'), `${preview}\n`)
  if (built.track) console.log(`Track: ${built.track.id} ("${built.track.title}" by ${built.track.artist}), ${built.timing!.total} s at ${built.timing!.bpm} BPM`)
  console.log(`${names.join(', ')} and the caption written to ${outDir}`)
}

export const tick = () => runtime.withLock(() => new Job(liveServices()).tick())

export async function review(id: string) {
  console.log(JSON.stringify(await new Job(liveServices()).review(id), null, 2))
}

export async function stickersDryRun(id: string, outDir: string) {
  const job = new Job(liveServices())
  const skipped = await runtime.withLock(() => job.previewStickers(id, outDir))
  console.log(`Instagram preview screenshots saved to ${outDir}; composer discarded without sharing.`)
  if (skipped.length) console.log(skippedMentionsText(skipped))
}

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
    const extra = draft.state === 'published' ? draft.publish?.permalink ?? PROFILE_URL : draft.skipReason ?? draft.note
    console.log([draft.id.padEnd(18), `r${draft.revision ?? 1}`, draft.state.padEnd(10), `draft ${fmt(window.draftAt)}`, `publish ${fmt(window.publishAt)}`,
      `deadline ${fmt(window.deadline)}`, `${draft.events.length} events`, draft.notify ? 'Slack reply pending' : '',
      draft.review?.investigation && !draft.review.investigation.findings ? 'Investigation pending' : '', extra ?? ''].join('  ').trimEnd())
  }
}

/**
 * The tick, dry-run, regenerate, and status commands. One JSON state file per draft under <state>/drafts.
 *
 * A draft moves previewing → previewed → publishing → published | skipped | failed | held. Every Instagram write
 * re-checks approval and the deadline (`beforeWrite`). When a preview exists, its outcome reply is a
 * separate pending step (`notify`), saved with the outcome and retried by later ticks until Slack takes it.
 */
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FixReceipt } from './catalog-fix.ts'
import { PublishStop, checkVeto, checkWrite, decide, readReactions, type Reactions } from './approval.ts'
import * as alerts from './alerts.ts'
import { fetchArtwork, type Artwork } from './artwork.ts'
import { caption as captionFor, delegatedReply, footerHandle, heldText, postedText, skippedMentionsText, skipText, slackPreview, tooFewText, type SkipReason } from './copy.ts'
import { hasDelegatedVeto, recordDelegatedVeto, type DelegatedDecision, type PreviewThread } from './delegation.ts'
import { baLocal } from './format.ts'
import { FORMATS, activeRuns, draftId, parseDraftId, runWindow, type FormatKey, type RunWindow } from './formats.ts'
import { FRAME, LAYOUT_VERSION, framesHtml } from './html.ts'
import { PROFILE_URL, StillProcessing, emptyPublishState, eventFrameTag, instagramApi, publish, type InstagramApi, type PublishJob, type PublishState, type Slide } from './instagram.ts'
import { askAll, endTime, flagged, hasCompleted, location, MAX_INVESTIGATIONS, readFindings, readRecordedChecks, requestMatches, type Investigation, type InvestigationRequest } from './investigation.ts'
import { fixLog, investigatorRunning, startInvestigator, stopInvestigator } from './investigator-run.ts'
import { nextTrack, readTracks, readyTrack, type DraftTrack, type ReadyTrack } from './reel/music.ts'
import { reelTiming, type ReelTiming } from './reel/project.ts'
import type { ReviewResources } from './review-evidence.ts'
import { eventReplyLines, eventResourceLines, lookupReviewBarrio, recordedCheckLines, splitReviewReply, streetForUsig, withReviewLinks, type ReviewBarrioLookup, type ReviewEventReply, type ReviewPartReceipt, type ReviewReplyDelivery } from './review-reply.ts'
import { adjudicateReviewQuestions, type QuestionResolver, type ReviewCitation, type ReviewSubject } from './review-resolution.ts'
import { allOk, copyHash, validateReview, type ReviewInput, type ReviewResult, type ReviewState, type Reviewer, type Verdict } from './review.ts'
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
  /** Reserved before sending a decision notice. Rebuilding does not clear it. */
  decisionBroadcastAttempted?: boolean
  reviewHistory?: ReviewResult[]
  reviewRebuilds?: { day: string; count: number }
  pendingReviewFixes?: ReturnType<typeof alerts.reviewFix>[]
  pendingReviewReplies?: ReviewReplyDelivery[]
  investigationCount?: number
  catalogFixes?: FixReceipt[]
  /** The active preview can outlive its revision. A pending share does not replace it until confirmed. */
  slack: { fileIds: string[]; ts: string | null; auto?: boolean; channel?: string; revision?: number; previews?: PreviewThread[]; pending?: PreviewShare }
  /** First observed Instagram ✅ or the time Hermes recorded Instagram approval for this revision. */
  approvedSeenAt: string | null
  delegatedApprovals?: DelegatedDecision[]
  r2Uploaded: string | null
  publish: PublishState | null
  /** Present only when a new preview was built with Threads enabled. It owns its own outcome and Slack reply. */
  threads?: ThreadsDraft
  /** A Threads hold alert survives rebuilding until a later revision posts. */
  threadsHoldOpen?: boolean
  /** Saved before the Business Suite Share click. Its presence permanently forbids another write. */
  storyShare?: StoryShareAttempt
  /** A pre-Share browser failure fixes this draft on the Graph route, including retries. */
  stickerFallback?: StickerFailure
  /** Total failures for the publish retry budget, separate from the shared tick streak. */
  publishFailures: number
  /** A Slack message still to deliver for this draft's outcome. */
  notify: { text: string; threadTs: string | null; channel?: string; failures?: number; rebuilt?: boolean } | null
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
  reviewResources(ids: string[]): Promise<Map<string, ReviewResources>>
  resolveQuestions?: QuestionResolver
  fetchUsig?: typeof fetch
  investigator?: { start: typeof startInvestigator; running: typeof investigatorRunning; stop?: typeof stopInvestigator }
  slackUploadFiles(frames: string[], draftId: string): Promise<Array<{ id: string; title: string }>>
  slackShareFiles(files: Array<{ id: string; title: string }>, text: string, channel: string): Promise<unknown>
  slackShareTs(fileId: string, channel: string): Promise<string | null>
  slackPost(text: string, threadTs: string | null, channel: string, broadcast?: boolean, receipt?: ReviewPartReceipt): Promise<unknown>
  slackReviewReceipt(channel: string, threadTs: string | null, receipt: ReviewPartReceipt): Promise<string | null>
  slackPermalink(ts: string, channel: string): Promise<string>
  slackReactions(ts: string, channel: string): Promise<Array<{ name: string; users?: string[] }> | undefined>
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
  reviewResources: runtime.reviewResources,
  resolveQuestions: runtime.resolveQuestions,
  investigator: { start: startInvestigator, running: investigatorRunning, stop: stopInvestigator },
  slackUploadFiles: runtime.slackUploadFiles,
  slackShareFiles: runtime.slackShareFiles,
  slackShareTs: runtime.slackShareTs,
  slackPost: (text, ts, channel, broadcast, receipt) => runtime.slackPost(text, ts, channel, broadcast, undefined, receipt),
  slackReviewReceipt: runtime.slackReviewReceipt,
  slackPermalink: runtime.slackPermalink,
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
const UNACKNOWLEDGED_FIX = 'A catalog correction has no D1 acknowledgement; check the fix log.'
const UNREADABLE_FIX_LOG = 'The investigator fix log could not be read.'
const holdsCatalogWrite = (investigation?: Investigation) => investigation?.catalogWriteHold ||
  investigation?.failure === UNACKNOWLEDGED_FIX || investigation?.failure === UNREADABLE_FIX_LOG
const REVIEW_ALERT_LEAD_MS = 30 * 60_000
/** States a tick no longer advances (a pending notification is still delivered). */
const SETTLED: DraftState[] = ['published', 'skipped', 'failed', 'held']

type DelegatedAction = keyof typeof delegatedReply
type PreviewShare = { fileIds: string[]; channel: string; revision: number; includesThreads: boolean; includesInstagram?: boolean }
type DraftDecision = Reactions & { threadsApproved: boolean }
const undecided: DraftDecision = { approved: false, rejected: false, threadsApproved: false }
const anyApproval = (decision: DraftDecision) => decision.approved || decision.threadsApproved

class DecisionUnknown extends Error {}
class DraftChanged extends Error {}

const previewChannel = (draft: Draft) => draft.slack.channel ?? runtime.LEGACY_SLACK_CHANNEL

export class Job {
  private readonly reviewedThisTick = new Set<string>()
  private readonly barriosThisTick = new Map<string, Promise<ReviewBarrioLookup | null>>()
  private readonly snapshots = new WeakMap<Draft, string | null>()

  constructor(readonly s: Services) {}

  private get drafts() { return join(this.s.stateDir, 'drafts') }
  draftFile(id: string) { return join(this.drafts, `${id}.json`) }
  private framesDir(id: string) { return join(this.drafts, id) }

  private draftSource(id: string) {
    const file = this.draftFile(id)
    return existsSync(file) ? readFileSync(file, 'utf8') : null
  }

  loadDraft(id: string): Draft | null {
    const source = this.draftSource(id)
    if (source === null) return null
    const draft: Draft = JSON.parse(source)
    this.snapshots.set(draft, source)
    return draft
  }

  private assertCurrent(draft: Draft) {
    // Check the full saved snapshot, including revision. A save within the same tick may have the same updatedAt.
    if (this.snapshots.get(draft) !== this.draftSource(draft.id)) throw new DraftChanged(`${draft.id}: saved draft changed while working on r${draft.revision}`)
  }

  private save(draft: Draft) {
    this.assertCurrent(draft)
    draft.updatedAt = this.s.now().toISOString()
    runtime.writeJson(this.draftFile(draft.id), draft)
    this.snapshots.set(draft, `${JSON.stringify(draft, null, 2)}\n`)
  }

  private draftIds() {
    return existsSync(this.drafts) ? readdirSync(this.drafts).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)) : []
  }

  allDrafts(): Draft[] {
    return this.draftIds().flatMap(id => this.loadDraft(id) ?? [])
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
  async createDraft(format: FormatKey, from: string, exclude: string[], revision: number, trackId: string | null = null): Promise<Draft> {
    const id = draftId(format, from)
    const current = this.loadDraft(id)
    if (current && (current.state !== 'rebuilding' || current.revision !== revision)) throw new DraftChanged(`${id}: another revision is already saved`)
    const dir = join(this.framesDir(id), `rev-${revision}`)
    const built = await this.build(format, from, exclude, dir, format === 'reel' ? trackId ?? this.chooseTrack() : null)
    const draft: Draft = {
      id, format, from, to: built.window.to, revision, layout: LAYOUT_VERSION, state: 'previewing', exclude, events: built.events, caption: built.caption, track: built.track,
      frames: built.frames ?? [], framesHash: built.frames ? runtime.fileHash(built.frames) : '', slack: current?.slack ?? { fileIds: [], ts: null },
      review: { reelHoldMids: built.timing?.cards.slice(1).map(card => card.holdMid), unavailableAlert: current?.review?.unavailableAlert },
      decisionBroadcastAttempted: current?.decisionBroadcastAttempted,
      reviewHistory: current?.reviewHistory, reviewRebuilds: current?.reviewRebuilds, pendingReviewFixes: current?.pendingReviewFixes,
      pendingReviewReplies: current?.pendingReviewReplies,
      investigationCount: current?.investigationCount, catalogFixes: current?.catalogFixes, threadsHoldOpen: current?.threadsHoldOpen,
      approvedSeenAt: null, r2Uploaded: null, publish: null, publishFailures: 0, notify: null, skipReason: null, note: null, updatedAt: '', threads: current?.threads,
    }
    this.snapshots.set(draft, current ? this.snapshots.get(current)! : null)
    if (!built.frames) {
      rmSync(dir, { recursive: true, force: true })
      draft.state = 'skipped'
      draft.skipReason = skipText({ kind: 'too-few', count: built.events.length })
      if (draft.slack.ts) draft.notify = { threadTs: draft.slack.ts, text: `${draft.skipReason} after rebuilding. Nothing new will publish.` }
      this.save(draft)
      this.s.log(`${id}: ${draft.skipReason}`)
      await this.deliver(id)
      return this.loadDraft(id)!
    }
    this.queueRebuiltReply(draft)
    this.prepareRevision(draft, this.s.config())
    await this.tryReview(draft, this.reviewSlot(draft, built.window, this.openThreadsWindow(draft)))
    await this.sendPreview(draft, built.window)
    await this.deliver(id)
    return this.loadDraft(id)!
  }

  private prepareRevision(draft: Draft, config: Config) {
    if (draft.slack.auto !== undefined) return
    this.verifyFrames(draft)
    const { format } = draft
    draft.review ??= {} // No preview has been handed to Slack yet.
    draft.slack.auto = config.auto[format]
    if (isThreadsFormat(format) && !draft.threads) {
      const beforeCutoff = this.s.now() < threadsWindow(format, draft.from).cutoff
      if (config.threads.enabled && beforeCutoff) {
        draft.threads = { ...newThreadsDraft(threadsText(format, draft.events), config.threads.auto[format]), revision: draft.revision }
      }
    }
    this.save(draft)
  }

  private previewThreads(draft: Draft): PreviewThread[] {
    if (draft.slack.previews) return draft.slack.previews
    const { ts, revision = draft.revision } = draft.slack
    const threads = draft.threads
    // Backfill the known Slack threads from drafts written before previews were tracked separately.
    const previews: PreviewThread[] = ts ? [{ ts, channel: previewChannel(draft), revision, instagram: true,
      threads: Boolean(threads?.threadTs === ts || (threads?.text && threads.revision === undefined && !threads.threadTs)) }] : []
    if (threads?.threadTs && threads.threadTs !== ts) previews.push({ ts: threads.threadTs,
      channel: threads.threadChannel ?? runtime.LEGACY_SLACK_CHANNEL, revision: threads.revision ?? revision, instagram: false, threads: true })
    return previews
  }

  private hasCurrentPreview(draft: Draft, destination?: 'instagram' | 'threads') {
    return this.previewThreads(draft).some(preview => preview.revision === draft.revision && (!destination || preview[destination]))
  }

  private previewOffer(draft: Draft, window: RunWindow) {
    const now = this.s.now()
    const result = this.matchingReview(draft) ?? null
    const reviewed = this.reviewAllowsAuto(draft, result)
    const routing = this.reviewPreviewRouting(draft, result, reviewed)
    const igOpen = !SETTLED.includes(draft.state) && now < window.cutoff
    const threadsSlot = this.openThreadsWindow(draft)
    const igAlreadyShown = this.hasCurrentPreview(draft, 'instagram')
    const igAuto = this.instagramAutoMode(draft)
    const threadsAuto = this.threadsAutoMode(draft)
    const instagram = igOpen && !igAlreadyShown && !(igAuto && routing === 'fix-only')
    const threads = Boolean(threadsSlot && now < threadsSlot.cutoff && !this.hasCurrentPreview(draft, 'threads')
      && !(threadsAuto && routing === 'fix-only'))
    const needsApproval = (eligible: boolean, auto: boolean) => eligible && (!auto || (routing === 'normal' && !reviewed))
    return { instagram, threads, igOpen, igAlreadyShown, threadsSlot, reviewed, igAuto, threadsAuto,
      needed: needsApproval(instagram, igAuto) || needsApproval(threads, threadsAuto) }
  }

  private queueRebuiltReply(draft: Draft) {
    if (draft.slack.ts && (!draft.notify || draft.notify.rebuilt) && !SETTLED.includes(draft.state)) draft.notify = {
      threadTs: draft.slack.ts, channel: previewChannel(draft), rebuilt: true,
      text: `Rebuilt: revision ${draft.revision}. It can publish automatically if review and settings allow it. React ❌ on any of this draft's previews to stop it.`,
    }
  }

  private confirmPreview(draft: Draft, pending: PreviewShare, ts: string) {
    const threads = this.currentThreads(draft)
    const previews = this.previewThreads(draft)
    if (!previews.some(preview => preview.ts === ts && preview.channel === pending.channel)) {
      previews.push({ ts, channel: pending.channel, revision: pending.revision, instagram: pending.includesInstagram !== false, threads: pending.includesThreads })
    }
    draft.slack = { fileIds: pending.fileIds, ts, channel: pending.channel, revision: pending.revision, auto: draft.slack.auto, previews }
    if (pending.revision === draft.revision) {
      if (pending.includesThreads && threads && !retainThreads(threads)) {
        threads.threadTs = ts
        threads.threadChannel = pending.channel
      }
      if (draft.notify?.rebuilt) draft.notify = null
      if (draft.state === 'previewing') draft.state = 'previewed'
    } else {
      this.queueRebuiltReply(draft)
    }
    this.save(draft)
    this.s.log(`${draft.id}: confirmed Slack preview for r${pending.revision} (${ts})`)
  }

  private pendingPreview(draft: Draft): PreviewShare | undefined {
    // Previews already handed off before the separate pending record use the legacy channel and format.
    return draft.slack.pending ?? (!draft.slack.ts && draft.slack.fileIds.length
      ? { fileIds: draft.slack.fileIds, channel: previewChannel(draft), revision: draft.revision, includesThreads: Boolean(this.currentThreads(draft)?.text) }
      : undefined)
  }

  private async recoverPreview(draft: Draft) {
    const pending = this.pendingPreview(draft)
    if (!pending) return
    const ts = await this.s.slackShareTs(pending.fileIds[0]!, pending.channel)
    if (!ts) throw new DecisionUnknown('Slack preview lookup failed: the upload has no message yet')
    this.confirmPreview(draft, pending, ts)
  }

  private async sendPreview(draft: Draft, window: RunWindow) {
    await this.recoverPreview(draft)
    if (!this.previewOffer(draft, window).needed) {
      if (draft.state === 'previewing' && (this.s.now() < window.cutoff || this.instagramAuto(draft) || this.hasCurrentPreview(draft))) {
        draft.state = 'previewed'
        this.save(draft)
      }
      return
    }
    if ((await this.readDecision(draft)).rejected) return
    const offer = this.previewOffer(draft, window)
    if (!offer.needed) return
    this.verifyFrames(draft)
    const { format } = draft
    const config = this.s.config()
    const { instagram: includesInstagram, igOpen, igAlreadyShown, threadsSlot, igAuto, threadsAuto, reviewed } = offer
    const igMode = !igOpen ? 'closed' : igAlreadyShown ? 'already-previewed' : !includesInstagram ? 'threads-only'
      : igAuto && !reviewed ? 'review-hold' : igAuto
    let text = slackPreview(format, window, draft.caption, igMode, draft.track ?? undefined)
    const threadsText = offer.threads ? this.currentThreads(draft)?.text : null
    if (threadsText && threadsSlot) {
      text += threadsPreview(threadsText, threadsSlot.publishAt, threadsAuto && !reviewed ? 'review-hold' : threadsAuto, includesInstagram)
    } else if (config.threads.enabled && draft.threads?.mediaId) text += `\n\n${threadsPreviousRevision}`
    const files = await this.s.slackUploadFiles(format === 'reel' ? draft.frames.slice(0, 1) : draft.frames, draft.id)
    const share: PreviewShare = { fileIds: files.map(file => file.id), channel: config.slack.channel,
      revision: draft.revision, includesInstagram, includesThreads: Boolean(threadsText) }
    draft.slack.pending = share
    this.save(draft)
    try { await this.s.slackShareFiles(files, text, share.channel) } catch (error) {
      if (error instanceof runtime.SlackRejected) {
        delete draft.slack.pending // Slack confirmed that no message was posted. A later tick may retry.
        this.save(draft)
      }
      throw error
    }
    await this.recoverPreview(draft)
  }

  private async trySendPreview(draft: Draft, window: RunWindow, failures: alerts.TickFailures) {
    try { await this.sendPreview(draft, window) } catch (error) {
      if (error instanceof DraftChanged) throw error
      failures.record(draft, this.hasCurrentPreview(draft), error)
    }
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
    const threads = draft.threads
    if (!threads) return undefined
    const sameRevision = threads.revision !== undefined ? threads.revision === draft.revision : !threads.threadTs || threads.threadTs === draft.slack.ts
    return sameRevision ? threads : undefined
  }

  private openThreadsWindow(draft: Draft) {
    const threads = this.currentThreads(draft)
    return isThreadsFormat(draft.format) && this.s.config().threads.enabled && threads && !retainThreads(threads)
      && (threads.state === 'waiting' || threads.state === 'publishing') ? threadsWindow(draft.format, draft.from) : null
  }

  private delegatedApproval(draft: Draft, destination: 'instagram' | 'threads') {
    return draft.delegatedApprovals?.find(({ preview }) => preview.revision === draft.revision && preview[destination])
  }

  private delegatedVeto(draft: Draft): DraftDecision | undefined {
    if (hasDelegatedVeto(this.s.stateDir, draft.id)) return { ...undecided, rejected: true, delegatedVeto: true }
  }

  private async readDecision(draft: Draft): Promise<DraftDecision> {
    const veto = this.delegatedVeto(draft)
    if (veto) { this.assertCurrent(draft); return veto }
    const decision = { approved: Boolean(this.delegatedApproval(draft, 'instagram')), rejected: false,
      threadsApproved: Boolean(this.delegatedApproval(draft, 'threads')) }
    let failure = this.pendingPreview(draft) ? new DecisionUnknown('Slack preview lookup failed: the upload has no message yet') : undefined
    for (const preview of this.previewThreads(draft)) {
      try {
        const vote = readReactions(await this.s.slackReactions(preview.ts, preview.channel))
        if (vote.rejected) { decision.rejected = true; break }
        if (vote.approved && preview.revision === draft.revision) {
          decision.approved ||= preview.instagram
          decision.threadsApproved ||= preview.threads
        }
      } catch (error) {
        failure ??= new DecisionUnknown(error instanceof Error ? error.message : String(error))
      }
    }
    this.assertCurrent(draft)
    const latestVeto = this.delegatedVeto(draft) // Hermes can veto while Slack is responding.
    if (latestVeto) return latestVeto
    if (decision.rejected) return { ...undecided, rejected: true }
    if (failure) throw failure
    return decision
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

  private reviewAllowsAuto(draft: Draft, result = this.matchingReview(draft) ?? null) {
    if (!draft.review) return Boolean(draft.slack.ts) // Grandfather only previews already sent.
    const investigation = draft.review.investigation
    if (!result || holdsCatalogWrite(investigation)) return false
    if (allOk(result)) return true
    return result.post.verdict === 'ok' && Boolean(investigation?.findings && (!investigation.failure || result.questionResolution?.fallback?.resolved.length)
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
    if (!draft?.frames.length) throw new Error(`No rendered draft for ${id}; see \`status\`.`)
    return this.runReview(draft)
  }

  private reviewSlot(draft: Draft, window: RunWindow, threads: ReturnType<typeof threadsWindow> | null) {
    const now = this.s.now()
    const igSlot = !SETTLED.includes(draft.state) && now < window.deadline ? window.publishAt : null
    const threadsSlot = threads && now < threads.cutoff ? threads.publishAt : null
    return threadsSlot && (!igSlot || threadsSlot < igSlot) ? threadsSlot : igSlot
  }

  private async tryReview(draft: Draft, slot: Date | null) {
    const review = draft.review
    const existing = this.matchingReview(draft)
    const key = `${draft.id}:${draft.revision}`
    if (existing || !review || !slot || this.reviewedThisTick.has(key)) return existing
    this.reviewedThisTick.add(key)
    let result: ReviewResult
    try {
      if (review.result) throw new Error('The saved review no longer matches this preview. Regenerate the draft.')
      result = await this.runReview(draft)
      await this.resolveQuickQuestions(draft, result)
      this.verifyFrames(draft)
    } catch (error) {
      const failure = alerts.describeFailure(error).message
      this.s.log(`${draft.id}: review failed: ${failure}`)
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
    if (!draft.review.investigatorEnabled) for (const event of result.events) {
      if (event.verdict === 'wrong') this.queueReviewFix(draft, event.id, event)
    }
    if (result.post.verdict === 'wrong') (draft.pendingReviewFixes ??= []).push(alerts.reviewFix(draft, null, result.post))
    this.save(draft)
    return result
  }

  private async advanceReview(draft: Draft, window: RunWindow, failures: alerts.TickFailures): Promise<Draft | undefined> {
    if (!draft.frames.length) return
    if (!draft.slack.ts && !draft.slack.fileIds.length) this.prepareRevision(draft, this.s.config())
    const threadWindow = this.openThreadsWindow(draft)
    const slot = this.reviewSlot(draft, window, threadWindow)
    const reactions = () => this.readDecision(draft)
    const result = this.matchingReview(draft) ?? await this.tryReview(draft, slot && !(await reactions().catch(error => {
      if (!(error instanceof DecisionUnknown)) throw error
      return undecided // Read-only review can run; replacement and publication still require a known decision.
    })).rejected ? slot : null)
    const saved = draft.review?.investigation
    if (slot && result && !saved && !draft.review?.replied && await this.resolveQuickQuestions(draft, result)) {
      const fixes = draft.review?.investigatorEnabled ? [] : result.events.filter(event =>
        result.questionResolution?.quick?.resolved.some(item => item.id === event.id && item.verdict === 'wrong'))
      for (const event of fixes) this.queueReviewFix(draft, event.id, event)
      this.save(draft)
    }
    if (slot && result && saved && requestMatches(saved.request, draft, this.reviewInput(draft))) await this.resolveFallbackQuestions(draft, saved, result)
    if (slot) await this.trySendPreview(draft, window, failures)
    const review = draft.review
    if (!review) return
    const ts = draft.slack.ts
    const open = slot !== null
    const pendingInvestigation = review.investigation && (!review.investigation.findings || (review.investigation.failure && !review.investigation.failureAlerted))
    if (!open && !pendingInvestigation && (!review.result || (review.replied && !review.unavailableAlert))) return
    if (!result) return
    const state = draft.review!
    if (state.unavailableAlert) await this.reviewAction(draft, 'resolve alert', async () => {
      if (await this.s.resolveAlert(`${alerts.draftKey(draft)}/review`, `✅ Review completed for ${draft.id} r${draft.revision}.`) !== false) {
        delete state.unavailableAlert
        this.save(draft)
      }
    })
    if (state.investigatorEnabled && flagged(result).length) return this.advanceInvestigation(draft, result, window, threadWindow, open, failures)
    const wrong = result.events.filter(event => event.verdict === 'wrong')
    const hasError = wrong.length > 0 || result.post.verdict === 'wrong'
    if (wrong.length && this.canRebuildAfterReview(draft, window)) {
      const decision = await reactions()
      const day = baLocal(this.s.now()).date
      if (this.canAutoRebuild(draft, window, decision)) {
        return this.regenerate(draft.id, wrong.map(event => event.id), null, { day, count: draft.reviewRebuilds?.day === day ? draft.reviewRebuilds.count + 1 : 1 })
      }
    }
    if (!ts) return
    const hasQuestion = Boolean(result.post.question || result.events.some(event => event.question))
    await this.postReviewReply(draft, ts, async () => {
      if (allOk(result)) return ['Revisado: sin problemas.']
      const header = hasError ? 'Revisión: se detectó un error. Esta versión no se publicará automáticamente.' : 'Revisión: hace falta tu decisión.'
      const action = hasQuestion ? ['Respondé con ✅ o ❌ en la vista previa.'] : []
      const events = flagged(result).map(event => ({ id: event.id, title: draft.events.find(item => item.id === event.id)!.title,
        detail: event.question ?? event.reason!, flag: event, notInvestigated: 'Only the quick review ran.' }))
      return [header, ...action, ...await this.reviewEventBlocks(draft, events), ...this.postIssueLines(result.post)]
    }, state, window, hasQuestion)
  }

  private canRebuildAfterReview(draft: Draft, window: RunWindow) {
    return ['previewing', 'previewed'].includes(draft.state) && !draft.publish && !draft.storyShare && this.s.now() < window.cutoff
      && (draft.reviewRebuilds?.day !== baLocal(this.s.now()).date || draft.reviewRebuilds.count < MAX_REVIEW_REBUILDS)
  }

  private threadsApprovalOpen(draft: Draft) {
    const window = this.openThreadsWindow(draft)
    return Boolean(window && this.s.now() < window.cutoff)
  }

  private investigationOverridden(draft: Draft, window: RunWindow, decision: DraftDecision) {
    if (decision.rejected || !anyApproval(decision)) return decision.rejected
    const instagramNeedsReview = !decision.approved && !SETTLED.includes(draft.state) && this.s.now() < window.deadline
    const threadsNeedsReview = !decision.threadsApproved && this.threadsApprovalOpen(draft)
    return !instagramNeedsReview && !threadsNeedsReview
  }

  private rebuildBlockedByReaction(draft: Draft, decision: DraftDecision) {
    // An unsent Threads approval is tied to the old text. Wait for dispatch or closure rather than replacing it.
    return decision.rejected || decision.approved || (decision.threadsApproved && this.threadsApprovalOpen(draft))
  }

  private canAutoRebuild(draft: Draft, window: RunWindow, decision: DraftDecision) {
    return this.canRebuildAfterReview(draft, window) && !this.rebuildBlockedByReaction(draft, decision)
  }

  private reviewPreviewRouting(draft: Draft, result: ReviewResult | null, reviewed: boolean): 'normal' | 'investigating' | 'fix-only' {
    if (!result || result.post.verdict === 'question') return 'normal'
    const events = flagged(result)
    const wrong = result.post.verdict === 'wrong' || events.some(event => event.verdict === 'wrong')
    const question = events.some(event => event.verdict === 'question')
    if (!draft.review?.investigatorEnabled || !events.length) return wrong && !question ? 'fix-only' : 'normal'
    const investigation = draft.review.investigation
    if (!investigation?.findings || !requestMatches(investigation.request, draft, this.reviewInput(draft))) {
      return wrong ? 'fix-only' : 'investigating'
    }
    if (investigation.request.events.some(event => this.investigationAsks(investigation, event))) return 'normal'
    return reviewed ? 'normal' : 'fix-only'
  }

  private investigationAsks(investigation: Investigation, event: InvestigationRequest['events'][number]) {
    const { request, round } = investigation
    const fallback = investigation.fallback || investigation.failure || round > MAX_INVESTIGATIONS || request.endsAt <= request.startsAt
    return investigation.findings?.[event.id]?.verdict === 'ask' && (event.verdict === 'question' || !fallback)
  }

  private citationText(citations: ReviewCitation[]) {
    return citations.map(({ url, quote }) => `${url} — “${quote}”`).join('; ')
  }

  private queueReviewFix(draft: Draft, id: string, finding: Verdict, { checked, recorded }: alerts.ReviewFixEvidence = {}) {
    const quick = draft.review?.result?.questionResolution?.quick?.resolved.find(item => item.id === id && item.verdict === 'wrong')
    const pending = draft.pendingReviewFixes ??= []
    pending.push(alerts.reviewFix(draft, id, finding, { checked: checked ?? (quick ? this.citationText(quick.citations) : undefined), recorded }))
  }

  private queueInvestigationRepairAlert(draft: Draft, investigation: Investigation) {
    if (investigation.repairAlertQueued) return
    for (const [id, item] of Object.entries(investigation.findings ?? {})) {
      const field = investigation.request.events.find(event => event.id === id)?.field ?? null
      const evidence = { recorded: { revision: draft.revision, finding: item } }
      if (item.verdict === 'exclude' && !item.hermes) {
        this.queueReviewFix(draft, id, { verdict: 'wrong', field, reason: item.reason, question: null }, evidence)
      } else if (item.verdict === 'fixed') {
        this.queueReviewFix(draft, id, { verdict: 'wrong', field, question: null,
          reason: 'The catalog was corrected but this revision still shows the old information. Rebuild before publishing.' }, evidence)
      }
    }
    investigation.repairAlertQueued = true
    this.save(draft)
  }

  private keepQuickReviewFindings(draft: Draft, investigation: Investigation, reason: string) {
    investigation.fallback = true
    investigation.findings = askAll(investigation.request.events, reason)
    for (const event of investigation.request.events) {
      if (event.verdict === 'wrong') this.queueReviewFix(draft, event.id, event)
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
        : !['previewing', 'previewed'].includes(draft.state) || draft.publish || draft.storyShare || draft.approvedSeenAt ? 'The draft is no longer open for corrections.' : null
    return { request, round, why, dir: location(this.s.stateDir, request) }
  }

  private async queueInvestigation(draft: Draft, { request, round, why, dir }: ReturnType<Job['investigationPlan']>) {
    const investigation: Investigation = { request, round }
    draft.review!.investigation = investigation
    if (why) this.keepQuickReviewFindings(draft, investigation, why)
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
    if (!draft || !result || !flagged(result).length) throw new Error('No matching quick review with flagged events.')
    const current = this.currentThreads(draft)
    const thread = this.s.config().threads.enabled && isThreadsFormat(draft.format) && current && !retainThreads(current)
      ? threadsWindow(draft.format, draft.from) : null
    const window = runWindow(draft.format, draft.from)
    const plan = this.investigationPlan(draft, result, window, thread)
    if (draft.review?.investigation) return { existing: true, ...draft.review.investigation }
    if (dryRun) return plan
    if (plan.why) throw new Error(plan.why)
    await this.recoverPreview(draft)
    const decision = await this.readDecision(draft)
    if (this.investigationOverridden(draft, window, decision)) throw new Error('Hanif already decided on this preview.')
    draft.review!.investigatorEnabled = true
    return this.queueInvestigation(draft, plan)
  }

  private failInvestigation(draft: Draft, investigation: Investigation, reason: string, catalogWriteHold = false) {
    investigation.failure = reason
    if (catalogWriteHold) investigation.catalogWriteHold = true
    this.keepQuickReviewFindings(draft, investigation, reason)
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
      } catch (error) {
        if (error instanceof DraftChanged) throw error
        this.s.log(`${draft.id}: could not read the investigation fix log.`)
      }
    }
  }

  private async stopInvestigation(draft: Draft, by: 'reaction' | 'rebuild') {
    const investigation = draft.review?.investigation
    if (!investigation || investigation.findings) return
    this.assertCurrent(draft)
    runtime.writeJson(join(location(this.s.stateDir, investigation.request), 'stopped'), { by })
    await this.s.investigator?.stop?.(investigation.request).catch(() => undefined)
  }

  private async advanceInvestigation(draft: Draft, result: ReviewResult, window: RunWindow,
    threadWindow: ReturnType<typeof threadsWindow> | null, open: boolean, failures: alerts.TickFailures): Promise<Draft | undefined> {
    const state = draft.review!
    const reactions = () => this.readDecision(draft)
    let investigation = state.investigation
    const hadFindings = Boolean(investigation?.findings)
    // A terminal failure alert must still be delivered if Hanif reacted or the cutoff has passed.
    const alertFailure = async (item: Investigation) => {
      if (item.failure && !item.failureAlerted) await this.reviewAction(draft, 'investigator alert', async () => {
        item.failureAlerted = await this.s.alert('investigator', 'Publisher investigation needs Hermes',
          alerts.investigatorFailed(draft, item.failure!, location(this.s.stateDir, item.request)), `${draft.id} r${draft.revision}: ${item.failure}`, 20_000)
        if (item.failureAlerted) this.save(draft)
      })
    }
    if (investigation) await alertFailure(investigation)
    const decision = await reactions()
    const overridden = this.investigationOverridden(draft, window, decision)
    if (overridden && (!investigation || (!investigation.findings && !hasCompleted(location(this.s.stateDir, investigation.request))))) {
      if (investigation) {
        await this.stopInvestigation(draft, 'reaction')
        this.keepQuickReviewFindings(draft, investigation, 'A Slack reaction stopped the investigation.')
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
      const pending = () => !hasCompleted(dir) && this.s.now().getTime() < request.endsAt
      if (pending()) {
        const running = await this.s.investigator?.running(request).catch(() => false)
        if (pending()) {
          const previous = investigation.missedUnitProbes ?? 0
          const missed = running ? 0 : previous + 1
          // A single probe can fail while the unit is still running. Persist the count across ticks.
          if (missed < 2) {
            if (missed !== previous) {
              investigation.missedUnitProbes = missed || undefined
              this.save(draft)
            }
            return
          }
        }
      }
      const findings = readFindings(dir, request, this.s.now().getTime())
      try {
        const { applied, uncertain } = fixLog(dir)
        if (uncertain) this.failInvestigation(draft, investigation, UNACKNOWLEDGED_FIX, true)
        else if (findings && request.events.every(({ id }) => {
          const item = findings[id]!
          const fixes = applied.filter(fix => fix.id === id)
          if (item.verdict === 'fixed') return item.fixes.length === fixes.length && fixes.every(fix => item.fixes.includes(fix.operation))
          return item.verdict !== 'ok' || !fixes.length
        })) {
          investigation.findings = findings
          for (const [id, item] of Object.entries(findings)) if ('hermes' in item && item.hermes) {
            const field = item.verdict === 'ask' ? null : request.events.find(event => event.id === id)?.field ?? null
            this.queueReviewFix(draft, id, { verdict: 'wrong', field, reason: item.hermes, question: null }, { recorded: { revision: request.revision, finding: item } })
          }
          this.collectCatalogFixes(draft)
          this.save(draft)
        } else this.failInvestigation(draft, investigation, 'The investigator stopped without complete, valid, on-time findings.', applied.length > 0)
      } catch (error) {
        if (error instanceof DraftChanged) throw error
        this.failInvestigation(draft, investigation, UNREADABLE_FIX_LOG, true)
      }
    }
    await alertFailure(investigation)
    if (!overridden && open) await this.resolveFallbackQuestions(draft, investigation, result)
    const findings = investigation.findings!
    const exclusions = request.events.filter(({ id }) => findings[id]?.verdict === 'exclude').map(({ id }) => id)
    const repair = exclusions.length > 0 || Object.values(findings).some(item => item.verdict === 'fixed')
    const day = baLocal(this.s.now()).date
    const count = draft.reviewRebuilds?.day === day ? draft.reviewRebuilds.count : 0
    const canRebuild = !overridden && !holdsCatalogWrite(investigation) && this.canAutoRebuild(draft, window, decision)
    const hasAsk = request.events.some(event => this.investigationAsks(investigation, event))
    const willRebuild = repair && canRebuild && !hasAsk
    // A split approval does not resolve the other destination's error, even if it can be rebuilt later.
    if (!overridden && repair && (anyApproval(decision) || !willRebuild)) this.queueInvestigationRepairAlert(draft, investigation)
    if (!hadFindings && !willRebuild && !overridden && open) await this.trySendPreview(draft, window, failures)
    const ts = draft.slack.ts
    const fieldLabel = { description_display_es: 'Spanish description', description_display_en: 'English description',
      description_summary_es: 'Spanish summary', description_summary_en: 'English summary', name: 'title', starts_at: 'start time',
      price: 'price', is_free: 'free admission', status: 'status' } as const
    const hasQuestion = Boolean(result.post.question)
    if (ts) await this.postReviewReply(draft, ts, async () => {
      const events = request.events.map(event => {
        const { id, title } = event
        const item = findings[id]!
        const detail = item.verdict === 'ok' ? item.reason : item.verdict === 'exclude' ? `Exclude: ${item.reason}`
          : item.verdict === 'ask' ? this.investigationAsks(investigation, event) ? item.question : event.reason!
            : `Corrected ${draft.catalogFixes?.filter(fix => item.fixes.includes(fix.operation)).map(fix => {
              const n = fix.changes.length
              return `${fieldLabel[fix.field]} on ${n} occurrence${n === 1 ? '' : 's'}`
            }).join(', ')}.`
        // A real investigator can ask about a new fact; use its question, not the superseded quick flag.
        const flag = item.verdict === 'ask' && !investigation.fallback ? { field: item.field ?? null, question: item.question, reason: null } : event
        return { id, title, detail, flag,
          checks: investigation.fallback && item.verdict === 'ask' ? [] : [{ revision: draft.revision, finding: item }],
          notInvestigated: investigation.fallback && item.verdict === 'ask' ? item.checked : 'No sources were recorded.' }
      })
      const blocks = await this.reviewEventBlocks(draft, events, investigation.fallback)
      const action = !overridden && (hasAsk || hasQuestion) ? ['Respondé con ✅ o ❌ en la vista previa.'] : []
      return ['Revisión: investigación', ...blocks, ...this.postIssueLines(result.post), ...action]
    }, investigation, window, !willRebuild && !overridden && ((hasAsk && !investigation.failure) || hasQuestion))
    if (willRebuild) {
      const latest = await reactions()
      if (this.canAutoRebuild(draft, window, latest)) {
        return this.regenerate(draft.id, exclusions, null, { day, count: count + 1 })
      }
      if (!this.investigationOverridden(draft, window, latest)) this.queueInvestigationRepairAlert(draft, investigation)
    }
  }

  private reviewEvidence(draft: Draft, ids: string[]) {
    return this.s.reviewResources(ids).catch(() => {
      this.s.log(`${draft.id}: could not load catalog evidence for review.`)
      return new Map<string, ReviewResources>()
    })
  }

  private async adjudicateQuestions(draft: Draft, questions: ReviewSubject[], evidence?: Map<string, ReviewResources>, input = this.reviewInput(draft)) {
    evidence ??= await this.reviewEvidence(draft, questions.map(item => item.id))
    const subjects = questions.map(item => ({ ...item, evidence: evidence.get(item.id) }))
    return adjudicateReviewQuestions(input, subjects, async (content, pending) => {
      if (!this.s.resolveQuestions) return { model: null, resolved: [] }
      try { return await this.s.resolveQuestions(content, pending) } catch {
        this.s.log(`${draft.id}: question resolver unavailable; preserving the remaining questions.`)
        return { model: null, resolved: [] }
      }
    }, address => {
      const key = `${streetForUsig(address.street)} ${address.number}`
      if (!this.barriosThisTick.has(key)) this.barriosThisTick.set(key, lookupReviewBarrio(address, this.s.fetchUsig))
      return this.barriosThisTick.get(key)!
    })
  }

  private async resolveQuickQuestions(draft: Draft, result: ReviewResult) {
    if (!this.s.resolveQuestions || result.questionResolution?.quick) return false
    const questions = result.events.flatMap(item => item.verdict === 'question' && item.question
      ? [{ id: item.id, question: item.question, field: item.field }] : [])
    if (!questions.length) return false
    const audit = await this.adjudicateQuestions(draft, questions)
    for (const item of audit.resolved) {
      const target = result.events.find(event => event.id === item.id && event.verdict === 'question')
      if (!target) continue
      Object.assign(target, item.verdict === 'ok' ? { verdict: 'ok', field: null, reason: null, question: null }
        : { verdict: 'wrong', field: item.field, reason: item.reason, question: null })
    }
    result.questionResolution = { ...result.questionResolution, quick: audit }
    return true
  }

  private async resolveFallbackQuestions(draft: Draft, investigation: Investigation, result: ReviewResult) {
    if (!this.s.resolveQuestions || !investigation.fallback || holdsCatalogWrite(investigation) || investigation.replied || result.questionResolution?.fallback) return
    const { findings } = investigation
    if (!findings) return
    const questions = investigation.request.events.flatMap(event => {
      const item = findings[event.id]
      return event.verdict === 'question' && item?.verdict === 'ask' ? [{ id: event.id, question: item.question, field: event.field }] : []
    })
    if (!questions.length) return
    const dir = location(this.s.stateDir, investigation.request)
    try {
      const { applied, uncertain } = fixLog(dir)
      investigation.catalogWriteHold = uncertain || applied.length > 0 || existsSync(join(dir, 'catalog-fix.lock')) || undefined
    } catch { investigation.catalogWriteHold = true }
    if (investigation.catalogWriteHold) { this.save(draft); return }
    const audit = await this.adjudicateQuestions(draft, questions)
    for (const item of audit.resolved) {
      const url = item.citations[0]?.url
      if (!url || !questions.some(question => question.id === item.id)) continue
      const checked = this.citationText(item.citations)
      findings[item.id] = item.verdict === 'ok' ? { verdict: 'ok', reason: item.reason, url, checked }
        : { verdict: 'exclude', reason: item.reason, checked, hermes: item.reason }
      if (item.verdict === 'wrong') this.queueReviewFix(draft, item.id, { verdict: 'wrong', field: item.field, reason: item.reason, question: null }, { checked })
    }
    result.questionResolution = { ...result.questionResolution, fallback: audit }
    this.save(draft)
  }

  private postIssueLines(post: Verdict) {
    const problem = post.question ?? post.reason
    return problem ? [alerts.slackLiteral(problem)] : []
  }

  private async reviewEventBlocks(draft: Draft, events: ReviewEventReply[], includeCurrent = false) {
    if (!events.length) return []
    const ids = events.map(event => event.id)
    const checks = readRecordedChecks(this.s.stateDir, draft, ids, this.s.now().getTime(), includeCurrent)
    const evidence = await this.reviewEvidence(draft, ids)
    const audit = draft.review?.result?.questionResolution
    const saved = [...(audit?.fallback?.selections ?? []), ...(audit?.quick?.selections ?? [])]
    const subjects = events.map(event => ({ id: event.id, field: event.flag.field, question: event.flag.question ?? event.flag.reason ?? event.detail, displayOnly: true }))
    const same = (a: ReviewSubject, b: ReviewSubject) => a.id === b.id && a.field === b.field && a.question === b.question
    const missing = subjects.filter(subject => !saved.some(item => same(subject, item)))
    const selected = missing.length ? [...saved, ...((await this.adjudicateQuestions(draft, missing, evidence)).selections ?? [])] : saved
    const blocks = events.map((event, index) => eventReplyLines({ ...event, checks: [...(checks.get(event.id) ?? []), ...(event.checks ?? [])] },
      evidence.get(event.id), draft.catalogFixes ?? [], selected.find(item => same(subjects[index]!, item))))
    return blocks.flatMap((lines, index) => index ? ['', ...lines] : lines)
  }

  private async postReviewReply(draft: Draft, ts: string, build: () => Promise<string[]>, reply: ReviewState | Investigation, window: RunWindow, needsDecision: boolean) {
    const review = draft.review!
    const channel = previewChannel(draft)
    const preview = this.previewThreads(draft).find(preview => preview.ts === ts && preview.channel === channel && preview.revision === draft.revision)
    const approvalOpen = (decision = undecided) => (preview?.instagram && !decision.approved && !SETTLED.includes(draft.state) && this.s.now() < window.cutoff)
      || (preview?.threads && !decision.threadsApproved && this.threadsApprovalOpen(draft))
    const broadcast = channel === runtime.SLACK_ALERTS_CHANNEL
    const mayNotify = needsDecision && !draft.decisionBroadcastAttempted && !review.homeAttempted && approvalOpen()
    if (!mayNotify && reply.replied) return
    const lines = await build()
    let sendNotice = false
    let prefix = ''
    if (mayNotify) {
      if (!broadcast) {
        const permalink = await this.s.slackPermalink(ts, channel).catch(() => `https://app.slack.com/archives/${channel}/p${ts.replace('.', '')}`)
        prefix = `<${permalink}|Abrí la vista previa en Slack>\n`
      }
      // Read reactions after the evidence and permalink lookups so the decision check stays current.
      const decision = await this.readDecision(draft)
      sendNotice = !decision.rejected && Boolean(approvalOpen(decision))
    }
    if (!sendNotice && reply.replied) return
    const replyWasSent = reply.replied
    const reviewWasSent = review.replied
    const [first, ...rest] = splitReviewReply(lines, sendNotice ? prefix : '', sendNotice && !broadcast)
    const markReplied = () => {
      reply.replied = true
      review.replied = true
      this.save(draft)
    }
    if (!sendNotice && rest.length) {
      // The first ordinary thread part is a replayable message, not a decision broadcast.
      const pending = draft.pendingReviewReplies ??= []
      pending.push({ channel, threadTs: ts, parts: [first!, ...rest] })
      markReplied()
      return this.sendReviewOverflow(draft)
    }
    const destination = sendNotice ? runtime.SLACK_ALERTS_CHANNEL : channel
    const threadTs = sendNotice && !broadcast ? null : ts
    const delivery: ReviewReplyDelivery | undefined = rest.length ? { channel: destination, threadTs, parts: rest,
      ...(!threadTs ? { parent: this.reviewPartReceipt() } : {}) } : undefined
    const reserve = sendNotice || Boolean(delivery)
    // Keep continuations even if Slack posts the first part but its acknowledgement is lost.
    // A first decision notice is never broadcast again after an unclear response.
    if (delivery) (draft.pendingReviewReplies ??= []).push(delivery)
    if (sendNotice) draft.decisionBroadcastAttempted = true
    if (reserve) markReplied()
    await this.reviewAction(draft, sendNotice ? 'Slack decision notice' : 'Slack reply', async () => {
      let sent: unknown
      try { sent = await this.s.slackPost(first!, threadTs, destination, sendNotice && broadcast, delivery?.parent) } catch (error) {
        if (reserve && error instanceof runtime.SlackRejected) {
          if (sendNotice) delete draft.decisionBroadcastAttempted
          if (delivery) draft.pendingReviewReplies = draft.pendingReviewReplies?.filter(item => item !== delivery)
          reply.replied = replyWasSent
          review.replied = reviewWasSent
          this.save(draft)
        }
        throw error
      }
      if (!reserve) markReplied()
      if (!delivery) return
      if (!delivery.threadTs && sent && typeof sent === 'object' && 'ts' in sent && typeof sent.ts === 'string') {
        delivery.threadTs = sent.ts
        this.save(draft)
      }
      if (delivery.threadTs) await this.sendReviewOverflow(draft)
    })
  }

  private reviewPartReceipt(): ReviewPartReceipt {
    return { id: randomUUID(), since: this.s.now().getTime() }
  }

  private async sendReviewOverflow(draft: Draft) {
    const pending = draft.pendingReviewReplies
    if (!pending?.length) return
    const blocked = new Set<string>()
    for (const delivery of [...pending]) {
      let threadKey: string | undefined
      try {
        if (!delivery.threadTs && delivery.parent) {
          delivery.threadTs = await this.s.slackReviewReceipt(delivery.channel, null, delivery.parent)
          if (delivery.threadTs) this.save(draft)
        }
        // A missing parent can only belong to its own top-level notice, not another preview thread.
        if (!delivery.threadTs) continue
        threadKey = `${delivery.channel}:${delivery.threadTs}`
        if (blocked.has(threadKey)) continue
        while (delivery.parts.length) {
          const posted = delivery.inFlight && await this.s.slackReviewReceipt(delivery.channel, delivery.threadTs, delivery.inFlight)
          if (!posted) {
            delivery.inFlight ??= this.reviewPartReceipt()
            this.save(draft)
            try { await this.s.slackPost(delivery.parts[0]!, delivery.threadTs, delivery.channel, false, delivery.inFlight) } catch (error) {
              if (error instanceof runtime.SlackRejected) { delete delivery.inFlight; this.save(draft) }
              throw error
            }
          }
          delete delivery.inFlight
          delivery.parts.shift()
          if (!delivery.parts.length) pending.splice(pending.indexOf(delivery), 1)
          this.save(draft)
        }
      } catch (error) {
        if (error instanceof DraftChanged) throw error
        // A failed read is not proof about the write. Keep the receipt and this thread's ordering.
        if (threadKey) blocked.add(threadKey)
        this.s.log(`${draft.id}: could not deliver or reconcile review continuation.`)
      }
    }
  }

  private async reviewAction(draft: Draft, action: string, run: () => Promise<void>) {
    try { await run() } catch (error) {
      if (error instanceof DraftChanged) throw error
      this.s.log(`${draft.id}: could not deliver review ${action}`)
    }
  }

  // Outcomes and notifications

  /** Record an outcome and its Slack message together, then try to deliver it. */
  private async settle(draft: Draft, state: DraftState, text: string | null, extra: Partial<Draft> = {}) {
    Object.assign(draft, extra)
    draft.state = state
    const rebuilt = draft.notify?.rebuilt ? `${draft.notify.text}\n` : ''
    const instagram = this.previewThreads(draft).findLast(preview => preview.instagram && preview.revision === draft.revision)
    const threadTs = instagram?.ts ?? draft.slack.ts
    draft.notify = text && threadTs ? { text: `${rebuilt}${text}`, threadTs, channel: instagram?.channel ?? previewChannel(draft) } : null
    this.save(draft)
    this.s.log(`${draft.id}: ${state}${text ? ` (${text})` : ''}`)
    await this.deliver(draft.id)
  }

  private async skip(draft: Draft, reason: SkipReason) {
    if (draft.threads && (reason.kind === 'delegated-skip' || (reason.kind === 'rejected' && this.s.config().threads.enabled))) {
      stopThreads(draft.threads, reason.kind)
    }
    const text = skipText(reason)
    await this.settle(draft, 'skipped', reason.kind === 'delegated-skip' ? null : text, { skipReason: text })
    if (draft.publishFailures && reason.kind !== 'too-few') {
      await this.s.resolveAlert(alerts.draftKey(draft), alerts.publishSkipped(draft, reason, this.s.now()))
    }
  }

  /** Approval takes the tick lock. Veto writes only its own permanent receipt, even during a tick. */
  async delegateDecision(action: DelegatedAction, id: string, revision: number, reason: string, previewTs?: string): Promise<boolean> {
    const { format, from } = parseDraftId(id)
    const draft = this.loadDraft(id)
    if (!draft) throw new Error(`No draft ${id}; see \`status\``)
    reason = reason.trim()
    if (!reason) throw new Error('Give the source of Hanif’s instruction in --reason.')
    const previews = this.previewThreads(draft)
    let preview: PreviewThread
    if (action === 'approve') {
      if (revision !== draft.revision) throw new Error(`${id}: current revision is r${draft.revision}, not r${revision}.`)
      if (draft.state !== 'previewed') throw new Error(`${id}: cannot approve a draft in state ${draft.state}.`)
      const { cutoff } = runWindow(format, from)
      if (this.s.now() >= cutoff) throw new Error(`${id}: the Instagram approval cutoff has passed.`)
      const replay = draft.delegatedApprovals?.find(entry => entry.preview.revision === revision && entry.reason === reason)
      if (replay) {
        if (previewTs && replay.preview.ts !== previewTs) throw new Error(`${id}: that instruction already approved a different preview.`)
        return false
      }
      const matches = previews.filter(item => item.revision === revision && (!previewTs || item.ts === previewTs))
      if (matches.length > 1) throw new Error(`${id}: multiple previews for r${revision}; use --preview-ts to identify the one Hanif approved.`)
      if (!matches[0] || this.pendingPreview(draft)) throw new Error(`${id}: no confirmed current preview for r${revision}.`)
      preview = matches[0]
      const decision = await this.readDecision(draft)
      const now = this.s.now()
      if (now >= cutoff) throw new Error(`${id}: the Instagram approval cutoff has passed.`)
      if (decision.rejected) throw new Error(`${id}: Hanif already vetoed the draft.`)
      if (draft.delegatedApprovals?.some(entry => entry.preview.revision === revision && entry.preview.ts === preview.ts && entry.preview.channel === preview.channel)) return false
      const needsInstagram = preview.instagram && !decision.approved && !this.instagramAuto(draft)
      const needsThreads = preview.threads && !decision.threadsApproved && this.threadsApprovalOpen(draft) && !this.threadsAuto(draft)
      if (!needsInstagram && !needsThreads) throw new Error(`${id}: no destination on the specified preview needs approval.`)
      ;(draft.delegatedApprovals ??= []).push({ actor: 'hermes', at: now.toISOString(), reason, preview })
      if (preview.instagram) draft.approvedSeenAt ??= now.toISOString()
      this.save(draft)
    } else {
      if (this.delegatedVeto(draft)) return false
      const now = this.s.now()
      const threads = draft.threads
      // Threads may still be waiting for its slot or for the operator to re-enable it after Instagram finishes.
      const threadsOpen = isThreadsFormat(format) && threads && ['waiting', 'publishing'].includes(threads.state)
        && (threads.attemptedAt || threads.mediaId || now < threadsWindow(format, from).cutoff)
      if (!threadsOpen && !['previewing', 'previewed', 'publishing', 'held', 'rebuilding'].includes(draft.state)) {
        throw new Error(`${id}: cannot skip a draft in state ${draft.state} with no remaining publication.`)
      }
      const matches = previews.filter(item => (!previewTs || item.ts === previewTs) && (item.revision === revision || revision === draft.revision))
      const target = previewTs && matches.length !== 1 ? undefined : matches.at(-1)
      if (!target) throw new Error(`${id}: no matching confirmed preview for r${revision}.`)
      preview = target
      if (!recordDelegatedVeto(this.s.stateDir, id, { actor: 'hermes', at: now.toISOString(), reason, preview })) return false
    }
    try {
      await this.s.slackPost(delegatedReply[action], preview.ts, preview.channel)
    } catch {
      this.s.log(`${id}: could not send the delegated ${action} Slack reply`)
    }
    return true
  }

  /** Deliver a pending Slack message. A failure leaves it pending for the next tick. */
  private async deliver(id: string, rebuilt = false) {
    const draft = this.loadDraft(id)
    if (!draft?.notify || Boolean(draft.notify.rebuilt) !== rebuilt || (rebuilt && this.pendingPreview(draft))) return
    const notify = draft.notify
    const key = `${alerts.draftKey(draft)}/slack`
    if (!notify.threadTs) {
      // Quietly close a legacy delivery alert; never send the old top-level notice.
      if (await this.s.resolveAlert(key) === false) return
      draft.notify = null
      this.save(draft)
      return
    }
    try {
      await this.s.slackPost(notify.text, notify.threadTs, notify.channel ?? previewChannel(draft))
    } catch (error) {
      const failure = alerts.describeFailure(error)
      this.s.log(`${draft.id}: Slack reply failed: ${error}`)
      notify.failures = (notify.failures ?? 0) + 1
      this.save(draft)
      if (notify.failures >= alerts.ALERT_FAILURES) {
        await this.s.alert(key, alerts.draftTitle(draft), alerts.slackAlert(draft, failure, notify.failures, this.s.now()), failure.cause)
          .catch(() => this.s.log(`${draft.id}: could not raise the Slack reply alert`))
      }
      return
    }
    draft.notify = null
    this.save(draft)
    // The alert command does nothing when no alert was open, including for replies queued on the old version.
    await this.s.resolveAlert(key, alerts.slackRecovered(draft, this.s.now(), notify.threadTs))
      .catch(() => this.s.log(`${draft.id}: could not close the Slack reply alert`))
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

  private instagramAutoMode(draft: Draft) {
    return draft.slack.auto === true && this.s.config().auto[draft.format]
  }

  private threadsAutoMode(draft: Draft) {
    return isThreadsFormat(draft.format) && this.currentThreads(draft)?.auto === true && this.s.config().threads.auto[draft.format]
  }

  private instagramAuto(draft: Draft) { return this.instagramAutoMode(draft) && this.reviewAllowsAuto(draft) }
  private threadsAuto(draft: Draft) { return this.threadsAutoMode(draft) && this.reviewAllowsAuto(draft) }

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
      if (this.s.now() >= window.deadline) throw new PublishStop('deadline', 'The publishing deadline has passed')
      const decision = await this.readDecision(draft)
      checkWrite(window, decision, this.instagramAuto(draft), this.s.now())
      if (!eventsChecked) { await this.checkEvents(draft); eventsChecked = true }
      checkVeto(this.delegatedVeto(draft) ?? decision)
      this.assertCurrent(draft)
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
    await this.skip(draft, stop.kind === 'rejected' ? { kind: stop.delegatedVeto ? 'delegated-skip' : 'rejected' } : { kind: 'late', by: window.deadline })
  }

  async advance(id: string, failures: alerts.TickFailures): Promise<boolean | void> {
    const draft = this.loadDraft(id)
    if (!draft) return
    const now = this.s.now()
    const window = runWindow(draft.format, draft.from)
    if (draft.state === 'rebuilding') {
      // A regenerate that didn't finish. Its approval is already cleared, so nothing can publish from it.
      await this.settle(draft, 'failed', null, { note: 'A regenerate did not finish; run it again.' })
      return this.s.alert(alerts.draftKey(draft), alerts.draftTitle(draft), alerts.rebuildAlert(draft, now))
    }
    const rebuilt = await this.advanceReview(draft, window, failures).catch(error => {
      if (!(error instanceof DecisionUnknown)) throw error
      failures.record(draft, Boolean(draft.slack.ts), error)
    })
    if (rebuilt) return SETTLED.includes(rebuilt.state) ? undefined : this.advance(id, failures)
    if (SETTLED.includes(draft.state)) return
    if (draft.state === 'previewing' && this.s.now() >= window.cutoff && !this.instagramAuto(draft)) {
      // Hoy can still pass a retried review and auto-publish before its later deadline.
      const autoMode = this.instagramAutoMode(draft)
      const fixOnly = autoMode && this.reviewPreviewRouting(draft, this.matchingReview(draft) ?? null, false) === 'fix-only'
      if (!fixOnly && (this.s.now() >= window.deadline || !autoMode)) {
        await this.settle(draft, 'failed', null, { note: 'The preview never reached Slack before the cutoff.' })
        return this.s.alert(alerts.draftKey(draft), alerts.draftTitle(draft), alerts.previewExpired(draft, now, failures.last(draft.id)))
      }
    }
    if (draft.state === 'previewing' || draft.state === 'previewed') {
      const reactions = await this.readDecision(draft).catch(error => {
        if (error instanceof DecisionUnknown && this.s.now() >= window.deadline) return null
        throw error
      })
      const checkedAt = this.s.now()
      if (!reactions) return this.skip(draft, { kind: 'late', by: window.deadline })
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
    if (!['previewing', 'previewed', 'publishing'].includes(draft.state)) return
    let done: boolean
    try {
      done = await this.publishDraft(draft, window)
    } catch (error) {
      if (error instanceof DraftChanged || error instanceof DecisionUnknown) throw error
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
    this.reviewedThisTick.clear()
    this.barriosThisTick.clear()
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
    for (const id of this.draftIds()) {
      const draft = this.loadDraft(id)
      if (!draft) continue
      try {
        // Creation already tried any skip notice, but a pending preview gets another chance.
        this.collectCatalogFixes(draft)
        await this.sendReviewOverflow(draft)
        if (!attempted.has(draft.id)) await this.deliver(draft.id)
        await this.advance(draft.id, failures)
        await this.deliver(draft.id, true)
      } catch (error) {
        const latest = this.loadDraft(id) ?? draft
        failures.record(latest, Boolean(latest.slack.ts), error)
      }
    }
    await this.tickThreads()
    // Fix alerts are durable across rebuilds and don't delay a safe replacement or a human-approved send.
    for (const id of this.draftIds()) {
      const draft = this.loadDraft(id)
      if (!draft?.pendingReviewFixes?.length) continue
      const pending: NonNullable<Draft['pendingReviewFixes']> = []
      for (const fix of draft.pendingReviewFixes) {
        let text = fix.text
        // Older queued alerts only saved the text and key; recover at least the event and its resources.
        const oldId = /^review-fix\/([\da-f-]+)$/u.exec(fix.key)?.[1]
        const event = fix.event ?? (oldId ? { id: oldId, flag: { field: null, reason: null }, card: undefined, checked: undefined, recorded: undefined } : undefined)
        if (event) {
          const evidence = await this.reviewEvidence(draft, [event.id])
          const detail = event.flag.reason ?? ''
          const input = this.reviewInput(draft)
          if (event.card) input.events = [event.card]
          const selection = (await this.adjudicateQuestions(draft, [{ id: event.id, field: event.flag.field, question: detail, displayOnly: true }], evidence, input)).selections?.[0]
          if (event.checked) text += `\nChecked: ${withReviewLinks(event.checked)}`
          const { recorded } = event
          const earlier = readRecordedChecks(this.s.stateDir, { id: draft.id, revision: recorded?.revision ?? draft.revision },
            [event.id], this.s.now().getTime(), !recorded).get(event.id) ?? []
          const checks = recorded ? [recorded, ...earlier] : earlier
          text += `\n${[...recordedCheckLines(checks, draft.catalogFixes ?? []), ...eventResourceLines(event.id, evidence.get(event.id), selection)].join('\n')}`
        }
        const sent = await this.s.alert(fix.key, fix.title, text, fix.fingerprint, 20_000).catch(() => false)
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
    for (const id of this.draftIds()) {
      const draft = this.loadDraft(id)
      if (!draft) continue
      const { threads, format } = draft
      if (!threads || !isThreadsFormat(format)) continue
      const active = this.currentThreads(draft) === threads
      const ts = threads.threadTs ?? (active ? draft.slack.ts : null)
      const channel = threads.threadChannel ?? (ts === draft.slack.ts ? previewChannel(draft) : runtime.LEGACY_SLACK_CHANNEL)
      const window = threadsWindow(format, draft.from)
      if (this.delegatedVeto(draft) && stopThreads(threads, 'delegated-skip')) this.save(draft)
      const advanced = await advanceThreads(threads, window, {
        api,
        now: () => this.s.now(),
        sleep: ms => this.s.sleep(ms),
        save: () => this.save(draft),
        reactions: async () => {
          const decision = await this.readDecision(draft)
          return { ...decision, approved: active && decision.threadsApproved }
        },
        enabled,
        auto: () => this.threadsAuto(draft),
        checkEvents: () => this.checkEvents(draft),
        reply: ts ? text => this.s.slackPost(text, ts, channel) : undefined,
        log: text => this.s.log(`${draft.id}: ${text}`),
      }).then(() => true, () => {
        this.s.log(`${draft.id}: could not advance Threads state; see the saved draft`)
        return false
      })
      if (!advanced) continue
      if (threads.state === 'published' && draft.threadsHoldOpen) {
        try {
          if (await this.s.resolveAlert(`${alerts.draftKey(draft)}/threads`, `✅ Threads published the rebuilt draft ${draft.id}.`) !== false) {
            delete draft.threadsHoldOpen
            this.save(draft)
          }
        } catch { this.s.log(`${draft.id}: could not close the Threads hold alert`) }
      }
      if (threads.state === 'held' && threads.hold && !threads.holdAlertSent) {
        try {
          if (await this.s.alert(`${alerts.draftKey(draft)}/threads`, alerts.draftTitle(draft), alerts.heldAlert(draft, threads.hold, this.s.now(), 'Threads'))) {
            threads.holdAlertSent = true
            this.save(draft)
          }
        } catch { this.s.log(`${draft.id}: could not raise the Threads hold alert`) }
      }
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
    const { cutoff } = runWindow(format, from)
    if (now >= cutoff) throw new Error(`${id} is past its cutoff`)
    await this.recoverPreview(old)
    const decision = await this.readDecision(old)
    if (decision.delegatedVeto) throw new DecisionUnknown(`${id}: Hermes recorded a veto; it can't be rebuilt.`)
    if (decision.rejected || (reviewRebuilds && this.rebuildBlockedByReaction(old, decision))) throw new DecisionUnknown(`${id}: a Slack reaction stopped the rebuild`)
    if (this.s.now() >= cutoff) throw new Error(`${id} is past its cutoff`)
    this.assertCurrent(old)
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
      ? { ...old.threads, revision: old.threads.revision ?? old.revision,
        threadTs: old.threads.threadTs ?? (old.threads.revision === undefined ? old.slack.ts ?? undefined : undefined),
        threadChannel: old.threads.threadChannel ?? (old.threads.threadTs === undefined || old.threads.threadTs === old.slack.ts ? old.slack.channel : undefined) }
      : undefined
    await this.stopInvestigation(old, 'rebuild')
    if (this.delegatedVeto(old)) throw new DecisionUnknown(`${id}: Hermes recorded a veto; it can't be rebuilt.`)
    this.collectCatalogFixes(old)
    const reviewHistory = old.review?.result ? [...(old.reviewHistory ?? []), old.review.result] : old.reviewHistory
    const threadsHoldOpen = old.threadsHoldOpen || (old.threads?.state === 'held' && Boolean(old.threads.hold)) || undefined
    const unavailableAlert = old.review?.unavailableAlert
    const previousPreview = { fileIds: old.slack.ts ? old.slack.fileIds : [], ts: old.slack.ts, channel: old.slack.channel,
      revision: old.slack.revision ?? old.revision, previews: this.previewThreads(old) }
    const decisionBroadcastAttempted = old.decisionBroadcastAttempted || old.review?.homeAttempted || undefined
    delete old.delegatedApprovals
    Object.assign(old, { decisionBroadcastAttempted, reviewHistory, reviewRebuilds: reviewRebuilds ?? old.reviewRebuilds, review: { unavailableAlert },
      revision, state: 'rebuilding', exclude, track: savedTrack, approvedSeenAt: null, slack: previousPreview, notify: null, r2Uploaded: null, threads, threadsHoldOpen })
    this.save(old)
    // Keep all earlier previews for the veto, and the most recent for replies.
    let draft: Draft
    try {
      draft = await this.createDraft(format, from, exclude, revision, track)
    } catch (error) {
      const rendered = this.loadDraft(id)
      if (!reviewRebuilds || rendered?.state !== 'previewing') throw error
      this.s.log(`${id}: ${error instanceof Error ? error.message : String(error)}`)
      draft = rendered // The tick retries preview delivery independently of publication.
    }
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
    console.log(`${draft.id}: revision ${draft.revision} with ${draft.events.length} events${draft.slack.ts ? `, preview posted (${draft.slack.ts})` : ', no Slack preview'}`)
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

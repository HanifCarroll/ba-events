import { readFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PublishStop } from './approval.ts'
import { heldEventReason, type SkipReason } from './copy.ts'
import { addDays, baLocal, englishDates, hhmm, WEEKDAYS_EN } from './format.ts'
import { draftId, FORMATS, runWindow, TICK_MS } from './formats.ts'
import { InstagramError, PROFILE_URL } from './instagram.ts'
import type { Draft, Services } from './job.ts'
import type { Verdict } from './review.ts'
import { writeJson } from './runtime.ts'
import type { StickerFailure } from './story-stickers.ts'
import { isThreadsFormat, threadsWindow } from './threads-copy.ts'

const HOUR_MS = 60 * 60_000
export const ALERT_FAILURES = 3
const TRIAGE = '{triage}'
const CLI = 'bun scripts/instagram-publisher.ts'

type Item = Pick<Draft, 'id' | 'format' | 'from'>
type Failure = { message: string; cause: string }

const earlier = (a: Date, b: Date) => a.getTime() - b.getTime()
const when = (time: Date | string, now: Date) => {
  const local = baLocal(time)
  return `${local.date === baLocal(now).date ? '' : `${WEEKDAYS_EN[local.weekday]!.slice(0, 3)} `}${hhmm(local)}`
}
const nextTick = (now: Date) => new Date((Math.floor(now.getTime() / TICK_MS) + 1) * TICK_MS)
const next = (now: Date) => when(nextTick(now), now)
const name = (item: Item) => FORMATS[item.format].slackName
const dates = (item: Item) => englishDates(item.from, runWindow(item.format, item.from).to, 'compact')
const label = (item: Item) => `${name(item)} for ${dates(item)}`
const homeRelative = (text: string) => text.replaceAll(`${homedir()}/`, '~/')
const history = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th'} failed try in a row`
const codes = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(' · ')
const errorCode = (message: string) => `\`${message}\``
const composerEvidence = (dir?: string) => dir ? `composer evidence ${errorCode(homeRelative(dir))}` : undefined

export function describeFailure(error: unknown): Failure {
  const raw = error instanceof Error ? error.message : String(error)
  const line = homeRelative(raw.split(/\r?\n/)[0]!).replaceAll('`', "'")
  const message = line.length > 160 ? `${line.slice(0, 159)}…` : line
  let cause: string
  const render = /Rendering( the Reel)? failed(?: \((timed out)\))?/.exec(raw)
  if (render?.[2]) {
    cause = render[1] ? 'Building its video took longer than the 10-minute limit.' : 'Building its images took longer than the 3-minute limit.'
    if (error instanceof Error && 'availableMemoryMb' in error && typeof error.availableMemoryMb === 'number' && error.availableMemoryMb < 600) {
      cause += ` The VPS was short on memory then (${error.availableMemoryMb} MB free).`
    }
  } else if (render?.[1] || /Remuxing the Reel failed|Extracting the Reel cover failed|The rendered Reel isn't the expected/.test(raw)) cause = 'Building its video failed.'
  else if (render) cause = 'Building its images failed.'
  else if (/Slack .*failed/.test(raw)) cause = "Slack didn't accept the upload or message."
  else if (raw.includes('D1 read')) cause = 'Reading the catalog failed.'
  else if (raw.includes('R2 upload')) cause = 'Uploading the images for Instagram failed.'
  else if (error instanceof InstagramError && !raw.includes(': no response (')) cause = 'Instagram returned an error.'
  else if (/fetch failed|ECONNRESET|ETIMEDOUT|timed out|HTTP 50[234]|: no response \(/i.test(raw)) cause = "It couldn't reach the service; usually temporary."
  else cause = 'It stopped with an error.'
  return { message, cause }
}

export const draftKey = (item: Item) => `draft/${item.id}`
export const draftTitle = (item: Item) => `Instagram ${label(item)}`

export function threadsFailed(item: Item, reason: string | null, unclear: boolean, stateFile: string) {
  const title = `Threads ${label(item)}`
  const outcome = unclear ? `The publisher could not confirm whether the ${label(item)} went out on Threads`
    : `The ${label(item)} did not publish to Threads`
  return {
    title,
    text: [`🚨 *${outcome}*. ${TRIAGE}`, 'Check @baeventos.app on Threads. The publisher will not send this post again.',
      codes(item.id, reason ? errorCode(reason) : undefined, `state ${homeRelative(stateFile)}`)].join('\n'),
    fingerprint: JSON.stringify([unclear, reason]),
  }
}

export function reviewFix(draft: Draft, id: string | null, finding: Verdict) {
  const issue = [finding.field, finding.reason].join(': ')
  return {
    key: id ? `review-fix/${id}` : `${draftKey(draft)}/review-fix`,
    title: 'Publisher review found incorrect content',
    text: [`⚠️ *Fix a problem found by the publisher review*. ${TRIAGE}`,
      'Hermes should check the linked evidence and correct the catalog or the publisher.',
      codes(`Draft ${draft.id} r${draft.revision}`, `Event ${id ?? 'not specific to one event'}`, slackLiteral(issue))].join('\n'),
    fingerprint: issue,
    event: id ? { id, flag: finding } : undefined,
  }
}

/** Quote short model and catalog excerpts without allowing Slack mentions or markup. */
export function slackLiteral(value: string, format: 'plain' | 'quote' = 'plain') {
  const escaped = value.replace(/[\r\n]+/g, ' ').replaceAll('`', "'")
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  // Slack doesn't interpret emphasis inside code spans. Preserve punctuation in cited text.
  return format === 'quote' && /[*_~]/u.test(escaped) ? `\`${escaped}\`` : escaped.replace(/[*_~]/g, '')
}

export function investigatorFailed(draft: Draft, reason: string, dir: string) {
  return [`⚠️ *The ${label(draft)} investigation did not finish*. ${TRIAGE}`,
    'The publisher will not auto-publish this revision. Hermes should check the private run and fix logs before retrying any catalog change.',
    codes(draft.id, `revision ${draft.revision}`, reason, homeRelative(dir))].join('\n')
}

export function reviewUnavailable(draft: Draft, slot: Date, now: Date, error: unknown) {
  const failure = describeFailure(error)
  return [`⚠️ *The ${label(draft)} has no automated review for its ${when(slot, now)} slot*. ${TRIAGE}`,
    'Hermes should check the review setup. Without a review, the publisher only posts with an in-time ✅.',
    codes(draft.id, `revision ${draft.revision}`, slackLiteral(failure.message))].join('\n')
}

export function tokenAlert(warning: string, now: Date) {
  const text = homeRelative(warning.split(/\r?\n/)[0]!).replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, time => when(time, now))
  return `⚠️ *The Instagram token needs attention*. ${TRIAGE}\n${text}`
}

function publication(draft?: Draft | null) {
  const total = draft?.storyShare?.frameCount ?? draft?.publish?.units.length ?? 0
  const browserPending = Boolean(draft?.storyShare && draft.state === 'publishing')
  const out = draft?.storyShare && draft.state === 'published' ? total : draft?.publish?.units.filter(unit => unit.mediaId || unit.published).length ?? 0
  const pending = browserPending || (draft?.publish?.units.some(unit => unit.pendingSince) ?? false)
  const live = out > 0 && out === total
  const needsLink = live && !draft?.storyShare && !draft?.publish?.permalink
  const outcome = live ? 'is on Instagram' : out ? `posted ${out} of ${total} frames` : pending ? 'may already be on Instagram' : null
  return { total, out, pending, browserPending, live, needsLink, outcome }
}

type Publication = ReturnType<typeof publication>

function publishRetry(item: Item, { needsLink, out, pending, browserPending }: Publication, now: Date) {
  const { deadline } = runWindow(item.format, item.from)
  return needsLink ? `It tries again at ${next(now)} to find the link.`
    : !browserPending && nextTick(now) < deadline ? `It tries again at ${next(now)}. The last chance is ${when(deadline, now)}.`
    : pending ? `It checks again at ${next(now)} whether ${out ? 'another frame' : 'the post'} went out. It won't post anything new.`
    : `There is no retry before the ${when(deadline, now)} deadline.`
}

function publishAlert(draft: Draft, failure: TickFailure, now: Date, stateFile: string) {
  const saved = publication(draft)
  const { total, out, pending, live, needsLink, outcome } = saved
  const { deadline } = runWindow(draft.format, draft.from)
  const retryStage = draft.state === 'failed' ? 'gave up' : needsLink ? 'looking up link'
    : nextTick(now) >= deadline ? 'last retry passed' : 'retrying'
  const fingerprint = JSON.stringify([retryStage, outcome, pending, failure.cause])
  const alert = (lines: string[]) => ({ text: lines.join('\n'), fingerprint })
  if (draft.state === 'failed') {
    if (out && out < total) return { text: partialAlert(draft, failure.cause, out, stateFile), fingerprint }
    if (out) return alert([
      `⚠️ *The ${label(draft)} is on Instagram, but the publisher couldn't get its link*. ${TRIAGE}`,
      `${failure.cause} The publisher won't try again.`,
      codes(errorCode(failure.message), draft.id, `state ${homeRelative(stateFile)}`),
    ])
    return alert([
      `🚨 *The ${label(draft)} didn't publish*: the publisher gave up after ${draft.publishFailures} tries at ${when(now, now)}. ${TRIAGE}`,
      `${failure.cause} Nothing went out on Instagram, and the publisher won't try again.`,
      codes(errorCode(failure.message), draft.id, `state ${homeRelative(stateFile)}`),
    ])
  }
  const n = failure.count
  const verdict = live ? `The ${label(draft)} ${outcome}${needsLink ? ", but the publisher hasn't found its link" : ''}`
    : out ? `The ${label(draft)} has posted ${out} of ${total} frames so far`
    : pending ? `The publisher hasn't confirmed whether the ${label(draft)} went out`
    : `The ${label(draft)} hasn't published yet`
  return alert([
    `🚨 *${verdict}* (${n} tries since ${when(failure.firstFailedAt, now)}). ${TRIAGE}`,
    `${failure.cause} ${publishRetry(draft, saved, now)}`,
    codes(errorCode(failure.message), history(n), draft.id),
  ])
}

export const tokenRecovered = (now: Date) => `✅ *The Instagram token is working again* at ${when(now, now)}.`

export const publishRecovered = (draft: Draft, now: Date) =>
  `✅ *The ${label(draft)} is on Instagram* at ${when(now, now)}: ${draft.publish?.permalink ?? PROFILE_URL}`

export function stickersFallback(draft: Draft, failure: StickerFailure) {
  return [
    `⚠️ *The ${label(draft)} went out on Instagram without tappable links*. ${TRIAGE}`,
    failure.signIn ? 'Hermes needs to sign Facebook in again in the Pro agent browser.'
      : `The publisher could not ${failure.step}. Hermes should check Business Suite before the next Hoy Story.`,
    codes(draft.id, failure.signIn ? 'Business Suite sign-in required' : undefined, composerEvidence(failure.evidenceDir)),
  ].join('\n')
}

export function storyUnconfirmed(draft: Draft, now: Date, error?: string) {
  const { deadline } = runWindow(draft.format, draft.from)
  return [
    `🚨 *The ${label(draft)} is on hold*: the publisher couldn't confirm all its frames by ${when(deadline, now)}. ${TRIAGE}`,
    `Hermes needs to check @baeventos.app Stories. The publisher won't share it again.`,
    codes(draft.id, `Expected ${draft.storyShare!.frameCount} new frames`, error && errorCode(error), composerEvidence(draft.storyShare?.evidenceDir)),
  ].join('\n')
}

export function publishSkipped(draft: Draft, reason: Exclude<SkipReason, { kind: 'too-few' }>, now: Date) {
  const why = reason.kind === 'late' ? `its deadline passed at ${when(reason.by, now)}`
    : reason.kind === 'no-approval' ? `it didn't have a ✅ by ${when(reason.by, now)}` : 'you reacted ❌'
  return `⚠️ *The ${label(draft)} wasn't posted*: ${why}. No action needed.`
}

export function heldAlert(draft: Draft, event: NonNullable<PublishStop['stale']>, now: Date, destination: 'Instagram' | 'Threads' = 'Instagram') {
  const hasUploads = draft.publish?.units.some(unit => unit.containerId || unit.childIds?.some(Boolean))
  const rebuildBlocked = draft.publish || draft.storyShare || draft.state === 'publishing' || draft.state === 'published'
  const cutoff = runWindow(draft.format, draft.from).cutoff
  const threadsCutoff = destination === 'Threads' && isThreadsFormat(draft.format) ? threadsWindow(draft.format, draft.from).cutoff : null
  const rebuildBy = threadsCutoff && threadsCutoff < cutoff ? threadsCutoff : cutoff
  const item = destination === 'Threads' ? `${name(draft)} post on Threads` : label(draft)
  return [
    `⚠️ *The ${item} is on hold*: ${event.title.replace(/\s+/g, ' ')} ${heldEventReason[event.why]}. ${TRIAGE}`,
    `Nothing went out on ${destination}. ${hasUploads ? "Instagram already holds uploads, so the draft can't be rebuilt automatically."
      : rebuildBlocked ? "Instagram publishing already started, so the draft can't be rebuilt automatically."
      : now >= rebuildBy ? "It's too late to rebuild for this publication."
      : `Hermes can rebuild without that event before ${when(rebuildBy, now)}. The new revision requests approval only if it needs it.`}`,
    codes(`\`${event.id} ${event.detail}\``, draft.id, rebuildBlocked ? `${CLI} status`
      : now < rebuildBy ? `${CLI} regenerate ${draft.id} --exclude ${event.id}` : undefined),
  ].join('\n')
}

export function partialAlert(draft: Draft, reason: string, out: number, stateFile: string) {
  return [
    `🚨 *The ${label(draft)} stopped part-way*: ${out} of ${draft.publish!.units.length} frames went out. ${TRIAGE}`,
    `${reason.replace(/\s+/g, ' ').replace(/\.$/, '')}. Nothing more will be posted for it.`,
    codes(draft.id, `state ${homeRelative(stateFile)}`),
  ].join('\n')
}

export function rebuildAlert(draft: Draft, now: Date) {
  const cutoff = runWindow(draft.format, draft.from).cutoff
  return now < cutoff ? [
    `🚨 *Rebuilding the ${label(draft)} didn't finish*. ${TRIAGE}`,
    `It has no preview now, so it can't publish. Hermes can run the rebuild again before ${when(cutoff, now)}.`,
    `${draft.id} · ${CLI} regenerate ${draft.id}${draft.exclude.map(id => ` --exclude ${id}`).join('')}${draft.track ? ` --track ${draft.track.id}` : ''}`,
  ].join('\n') : [
    `🚨 *Rebuilding the ${label(draft)} didn't finish*. No action needed.`,
    `It's past its ${when(cutoff, now)} cutoff, so this one is lost. Nothing was posted.`,
    draft.id,
  ].join('\n')
}

export function previewExpired(item: Item, now: Date, lastFailure?: Failure) {
  const { cutoff } = runWindow(item.format, item.from)
  const spec = FORMATS[item.format]
  const nextRun = runWindow(item.format, addDays(item.from, spec.startWeekday === null ? 1 : 7))
  return [
    `🚨 *The ${label(item)} wasn't posted*: its preview never reached Slack before the ${when(cutoff, now)} cutoff. ${TRIAGE}`,
    `Nothing went out on Instagram.${nextRun.draftAt > now ? ` The next ${name(item)} drafts ${when(nextRun.draftAt, now)} as usual.` : ''}`,
    codes(lastFailure?.cause.startsWith('Slack ') ? errorCode(lastFailure.message) : undefined, item.id),
  ].join('\n')
}

export function slackAlert(draft: Draft, failure: Failure, n: number, now: Date) {
  const outcome = draft.state === 'published' ? 'is on Instagram' : draft.state === 'held' ? 'is on hold' : 'was skipped'
  const noun = draft.notify?.threadTs ? 'reply' : 'message'
  return [
    `⚠️ *The ${label(draft)} ${outcome}, but its Slack ${noun} didn't go through*. No action needed.`,
    `The publisher retries the ${noun} at ${next(now)}.${draft.publish?.permalink ? ` The post: ${draft.publish.permalink}` : ''}`,
    codes(errorCode(failure.message), history(n), draft.id),
  ].join('\n')
}

export const slackRecovered = (item: Item, now: Date, threadTs: string | null) =>
  `✅ *The Slack ${threadTs ? 'reply' : 'message'} for the ${label(item)} went through* at ${when(now, now)}.`

type TickFailure = Item & Failure & {
  count: number; firstFailedAt: string; lastFailedAt: string; hasPreview: boolean
  route?: 'tick' | 'publish'
}
const qualifies = (failure: TickFailure) => failure.count >= ALERT_FAILURES || (!failure.hasPreview &&
  Date.parse(failure.lastFailedAt) - runWindow(failure.format, failure.from).draftAt.getTime() >= HOUR_MS)
const onTickAlert = (failure: TickFailure) => failure.route === 'tick' || (!failure.route && qualifies(failure))

function readStreaks(file: string, s: Services): Record<string, TickFailure> {
  try {
    const saved: Record<string, TickFailure> = JSON.parse(readFileSync(file, 'utf8'))
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || !Object.entries(saved).every(([id, item]) =>
      item?.id === id && Object.hasOwn(FORMATS, item.format) && /^\d{4}-\d\d-\d\d$/.test(item.from) && id === draftId(item.format, item.from) &&
      Number.isFinite(runWindow(item.format, item.from).draftAt.getTime()) && Number.isInteger(item.count) && item.count > 0 &&
      Number.isFinite(Date.parse(item.firstFailedAt)) && Number.isFinite(Date.parse(item.lastFailedAt)) &&
      typeof item.hasPreview === 'boolean' && typeof item.cause === 'string' && typeof item.message === 'string' &&
      (item.route === undefined || item.route === 'tick' || item.route === 'publish'))) {
      throw new Error('Invalid failure streaks')
    }
    return saved
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {}
    const badFile = `${file}.bad-${s.now().getTime()}`
    s.log(`Ignoring unreadable ${file}: ${error}`)
    try { renameSync(file, badFile) } catch (renameError) { s.log(`Could not move ${file} to ${badFile}: ${renameError}`) }
    return {}
  }
}

type AlertedFailure = TickFailure & { publication: Publication }

const tickOutcome = (saved: Publication) => saved.outcome &&
  `${saved.outcome}${saved.needsLink ? ", but the publisher hasn't found its link" : ''}`

function tickAlertText(first: AlertedFailure, now: Date, rest: AlertedFailure[] = []) {
  const outcome = tickOutcome(first.publication)
  const problem = outcome ? `The ${label(first)} ${outcome}`
    : first.hasPreview ? `The Instagram publisher keeps failing on the ${label(first)}`
    : `The ${name(first)} preview for ${dates(first)} hasn't reached Slack`
  const retry = outcome ? publishRetry(first, first.publication, now)
    : first.hasPreview ? `It tries again at ${next(now)}.`
    : `The publisher tries again at ${next(now)}. The post is due ${when(runWindow(first.format, first.from).publishAt, now)}.`
  return [
    `🚨 *${problem}* (${first.count} tries since ${when(first.firstFailedAt, now)}). ${TRIAGE}`,
    `${first.cause} ${retry}`,
    ...rest.map(item => {
      const outcome = tickOutcome(item.publication)
      return `Also failing: the ${label(item)}${outcome ? ` ${outcome}` : ''} (${item.count} tries).`
    }),
    codes(errorCode(first.message), history(first.count), first.id),
  ].join('\n')
}

/** One entry per failed item per tick. Replacing the snapshot clears streaks that didn't recur. */
export class TickFailures {
  private readonly file: string
  private readonly previous: Record<string, TickFailure>
  private readonly current: Record<string, TickFailure> = {}
  private readonly publishing = new Map<string, { draft: Draft; stateFile: string }>()

  constructor(private readonly s: Services) {
    this.file = join(s.stateDir, 'tick-failures.json')
    this.previous = readStreaks(this.file, s)
  }

  last(id: string) { return this.previous[id] }

  record({ id, format, from }: Item, hasPreview: boolean, error: unknown) {
    const lastFailedAt = this.s.now().toISOString()
    const prev = this.previous[id]
    this.s.log(`${id}: ${error instanceof Error ? error.message : String(error)}`)
    this.current[id] = { id, format, from, hasPreview, ...describeFailure(error), count: (prev?.count ?? 0) + 1,
      firstFailedAt: prev?.firstFailedAt ?? lastFailedAt, lastFailedAt,
      route: prev && onTickAlert(prev) ? 'tick' : prev?.route }
  }

  recordPublish(draft: Draft, error: unknown, stateFile: string) {
    this.record(draft, true, error)
    this.publishing.set(draft.id, { draft, stateFile })
  }

  async report(loadDraft: (id: string) => Draft | null) {
    const now = this.s.now()
    const previous = Object.values(this.previous)
    const qualifying: AlertedFailure[] = []
    for (const item of Object.values(this.current)) {
      const publish = this.publishing.get(item.id)
      const gaveUp = publish?.draft.state === 'failed'
      const atRisk = publish && earlier(runWindow(item.format, item.from).deadline, new Date(item.lastFailedAt)) < HOUR_MS
      if (!item.route && !qualifies(item) && !gaveUp && !atRisk) continue
      // Keep updates in the existing thread across steps; a terminal publishing failure has its own alert.
      if (item.route === 'publish' || (publish && (item.route !== 'tick' || gaveUp))) {
        item.route = 'publish'
        const { text, fingerprint } = publish ? publishAlert(publish.draft, item, now, publish.stateFile)
          : { text: tickAlertText({ ...item, publication: publication(loadDraft(item.id)) }, now), fingerprint: `advance: ${item.cause}` }
        await this.s.alert(draftKey(item), draftTitle(item), text, fingerprint)
      } else {
        item.route = 'tick'
        qualifying.push({ ...item, publication: publication(publish?.draft ?? loadDraft(item.id)) })
      }
    }
    qualifying.sort((a, b) => a.firstFailedAt.localeCompare(b.firstFailedAt))
    // A render can keep failing until the window closes without ever creating a draft file.
    for (const item of previous) {
      if (!item.hasPreview && !this.current[item.id] && !loadDraft(item.id) && now >= runWindow(item.format, item.from).cutoff) {
        await this.s.alert(draftKey(item), draftTitle(item), previewExpired(item, now, item))
      }
    }
    const hasFailures = Object.keys(this.current).length > 0
    const [first, ...rest] = qualifying
    if (first) {
      // The reading is evidence, not a new cause each time the free memory changes.
      const fingerprint = JSON.stringify(qualifying.map(item => {
        const outcome = tickOutcome(item.publication)
        return [item.id, item.cause.replace(/ \(\d+ MB free\)/, ''), ...(outcome ? [outcome, item.publication.pending] : [])]
      }).sort())
      await this.s.alert('tick', 'Instagram publisher', tickAlertText(first, now, rest), fingerprint)
    } else if (previous.some(onTickAlert)) {
      let stopped = false
      const outcomes = previous.filter(onTickAlert).sort((a, b) => a.firstFailedAt.localeCompare(b.firstFailedAt)).map(item => {
        const draft = loadDraft(item.id)
        const previewed = Boolean(draft?.slack.ts && draft.frames.length)
        const saved = publication(draft)
        if (saved.outcome) {
          if (draft?.state === 'failed') stopped = true
          const missingLink = draft?.state === 'failed' && saved.needsLink ? ", but the publisher couldn't get its link" : ''
          return `the ${label(item)} ${saved.outcome}${missingLink}`
        }
        const outcome = draft?.state === 'skipped' ? 'was skipped' : draft?.state === 'held' ? 'is on hold'
          : !item.hasPreview && (!draft || (draft.state === 'failed' && !previewed)) ? "didn't get a preview before cutoff"
          : draft?.state === 'failed' ? "didn't publish" : null
        if (outcome) {
          stopped = true
          return `the ${label(item)} ${outcome}`
        }
        if (!item.hasPreview && previewed) return `the ${name(item)} preview for ${dates(item)} is in Slack`
        return `the ${label(item)} is moving again`
      })
      const verdict = stopped ? '⚠️ *Instagram publisher stopped retrying*' : '✅ *Instagram publisher recovered*'
      const resolved = await this.s.resolveAlert('tick', `${verdict} at ${when(now, now)}: ${outcomes.join('; ')}.`)
      if (resolved === false && !hasFailures) return // Keep the named recovery for the next clean tick.
    } else if (!hasFailures) {
      // A pre-upgrade alert may already be open with no recorded streak.
      await this.s.resolveAlert('tick', `✅ *Instagram publisher recovered* at ${when(now, now)}: the latest tick finished without errors.`)
    }
    if (previous.length || hasFailures) writeJson(this.file, this.current)
  }
}

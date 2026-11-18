import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PublishStop } from './approval.ts'
import type { SkipReason } from './copy.ts'
import { addDays, baLocal, englishDates, hhmm, WEEKDAYS_EN } from './format.ts'
import { FORMATS, runWindow, TICK_MS, type FormatKey } from './formats.ts'
import { InstagramError } from './instagram.ts'
import type { Draft, Services } from './job.ts'
import { writeJson } from './runtime.ts'

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
  } else if (render) cause = render[1] ? 'Building its video failed.' : 'Building its images failed.'
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

export function tokenAlert(warning: string, now: Date) {
  const text = homeRelative(warning.split(/\r?\n/)[0]!).replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, time => when(time, now))
  return `⚠️ *The Instagram token needs attention*. ${TRIAGE}\n${text}`
}

export function publishAlert(draft: Draft, failure: Failure, now: Date, stateFile: string) {
  const total = draft.publish?.units.length ?? 0
  const out = draft.publish?.units.filter(unit => unit.mediaId || unit.published).length ?? 0
  if (draft.state === 'failed') {
    if (out && out < total) return partialAlert(draft, failure.cause, out, stateFile)
    if (out) return [
      `⚠️ *The ${label(draft)} is on Instagram, but the publisher couldn't get its link*. ${TRIAGE}`,
      `${failure.cause} The publisher won't try again.`,
      codes(errorCode(failure.message), draft.id, `state ${homeRelative(stateFile)}`),
    ].join('\n')
    return [
      `🚨 *The ${label(draft)} didn't publish*: the publisher gave up after ${draft.publishFailures} tries at ${when(now, now)}. ${TRIAGE}`,
      `${failure.cause} Nothing went out on Instagram, and the publisher won't try again.`,
      codes(errorCode(failure.message), draft.id, `state ${homeRelative(stateFile)}`),
    ].join('\n')
  }
  const n = draft.publishFailureStreak!
  const { deadline } = runWindow(draft.format, draft.from)
  const pending = draft.publish?.units.some(unit => unit.pendingSince)
  const needsLink = out > 0 && out === total
  const verdict = needsLink ? `The ${label(draft)} is on Instagram, but the publisher hasn't found its link`
    : out ? `The ${label(draft)} has posted ${out} of ${total} frames so far`
    : pending ? `The publisher hasn't confirmed whether the ${label(draft)} went out`
    : `The ${label(draft)} hasn't published yet`
  const retry = needsLink ? `It tries again at ${next(now)} to find the link.`
    : nextTick(now) < deadline ? `It tries again at ${next(now)}. The last chance is ${when(deadline, now)}.`
    : pending ? `It checks again at ${next(now)} whether ${out ? 'another frame' : 'the post'} went out. It won't post anything new.`
    : `There is no retry before the ${when(deadline, now)} deadline.`
  return [
    `🚨 *${verdict}* (${n} tries since ${when(draft.firstPublishFailureAt ?? now, now)}). ${TRIAGE}`,
    `${failure.cause} ${retry}`,
    codes(errorCode(failure.message), history(n), draft.id),
  ].join('\n')
}

export const tokenRecovered = (now: Date) => `✅ *The Instagram token is working again* at ${when(now, now)}.`

export const publishAtRisk = (deadline: Date, now: Date) => earlier(deadline, now) < HOUR_MS
export const publishRecovered = (draft: Draft, now: Date) =>
  `✅ *The ${label(draft)} is on Instagram* at ${when(now, now)}: ${draft.publish?.permalink}`

export function publishSkipped(draft: Draft, reason: Exclude<SkipReason, { kind: 'too-few' }>, now: Date) {
  const why = reason.kind === 'late' ? `its deadline passed at ${when(reason.by, now)}`
    : reason.kind === 'no-approval' ? `it didn't have a ✅ by ${when(reason.by, now)}` : 'you reacted ❌'
  return `⚠️ *The ${label(draft)} wasn't posted*: ${why}. No action needed.`
}

export function heldAlert(draft: Draft, event: NonNullable<PublishStop['stale']>, now: Date) {
  const hasUploads = draft.publish?.units.some(unit => unit.containerId || unit.childIds?.some(Boolean))
  const cutoff = runWindow(draft.format, draft.from).cutoff
  return [
    `⚠️ *The ${label(draft)} is on hold*: ${event.title.replace(/\s+/g, ' ')} ${event.why === 'over' ? 'has already happened' : 'was cancelled'}. ${TRIAGE}`,
    hasUploads ? "Nothing was posted, but Instagram already holds its uploads, so it can't be rebuilt automatically."
      : draft.publish ? "Nothing was posted, but publishing already started, so it can't be rebuilt automatically."
      : now >= cutoff ? "Nothing went out on Instagram. It's too late to approve a new preview."
      : `Nothing went out on Instagram. To post it, Hermes rebuilds it without that event and you approve the new preview by ${when(cutoff, now)}.`,
    codes(`\`${event.id} ${event.detail}\``, draft.id, draft.publish ? `${CLI} status`
      : now < cutoff ? `${CLI} regenerate ${draft.id} --exclude ${event.id}` : undefined),
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

type TickFailure = Item & Failure & { count: number; firstFailedAt: string; lastFailedAt: string; hasPreview: boolean }
const qualifies = (failure: TickFailure) => failure.count >= ALERT_FAILURES || (!failure.hasPreview &&
  Date.parse(failure.lastFailedAt) - runWindow(failure.format, failure.from).draftAt.getTime() >= HOUR_MS)

/** One entry per failed item per tick. Replacing the snapshot clears streaks that didn't recur. */
export class TickFailures {
  private readonly file: string
  private readonly previous: Record<string, TickFailure>
  private readonly current: Record<string, TickFailure> = {}

  constructor(private readonly s: Services) {
    this.file = join(s.stateDir, 'tick-failures.json')
    this.previous = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {}
  }

  last(id: string) { return this.previous[id] }

  record(id: string, format: FormatKey, from: string, hasPreview: boolean, error: unknown) {
    const lastFailedAt = this.s.now().toISOString()
    const prev = this.previous[id]
    this.s.log(`${id}: ${error instanceof Error ? error.message : String(error)}`)
    this.current[id] = { id, format, from, hasPreview, ...describeFailure(error), count: (prev?.count ?? 0) + 1,
      firstFailedAt: prev?.firstFailedAt ?? lastFailedAt, lastFailedAt }
  }

  async report(loadDraft: (id: string) => Draft | null) {
    const now = this.s.now()
    const previous = Object.values(this.previous)
    const qualifying = Object.values(this.current).filter(qualifies).sort((a, b) => a.firstFailedAt.localeCompare(b.firstFailedAt))
    // A render can keep failing until the window closes without ever creating a draft file.
    for (const item of previous) {
      if (!item.hasPreview && !this.current[item.id] && !loadDraft(item.id) && now >= runWindow(item.format, item.from).cutoff) {
        await this.s.alert(draftKey(item), draftTitle(item), previewExpired(item, now, item))
      }
    }
    const hasFailures = Object.keys(this.current).length > 0
    const [first, ...rest] = qualifying
    if (first) {
      const problem = first.hasPreview ? `The Instagram publisher keeps failing on the ${label(first)}`
        : `The ${name(first)} preview for ${dates(first)} hasn't reached Slack`
      const retry = first.hasPreview ? `It tries again at ${next(now)}.`
        : `The publisher tries again at ${next(now)}. The post is due ${when(runWindow(first.format, first.from).publishAt, now)}.`
      const text = [
        `🚨 *${problem}* (${first.count} tries since ${when(first.firstFailedAt, now)}). ${TRIAGE}`,
        `${first.cause} ${retry}`,
        ...rest.map(item => `Also failing: the ${label(item)} (${item.count} tries).`),
        codes(errorCode(first.message), history(first.count), first.id),
      ].join('\n')
      // The reading is evidence, not a new cause each time the free memory changes.
      const fingerprint = JSON.stringify(qualifying.map(item => [item.id, item.cause.replace(/ \(\d+ MB free\)/, '')]).sort())
      await this.s.alert('tick', 'Instagram publisher', text, fingerprint)
    } else if (previous.some(qualifies)) {
      let missedCutoff = false
      const outcomes = previous.filter(qualifies).sort((a, b) => a.firstFailedAt.localeCompare(b.firstFailedAt)).map(item => {
        const draft = loadDraft(item.id)
        if (!item.hasPreview && draft?.slack.ts && draft.frames.length) return `the ${name(item)} preview for ${dates(item)} is in #ba-eventos`
        if (!item.hasPreview && (!draft || draft.state === 'failed')) {
          missedCutoff = true
          return `the ${label(item)} didn't get a preview before cutoff`
        }
        return `the ${label(item)} is moving again`
      })
      const verdict = missedCutoff ? '⚠️ *Instagram publisher stopped retrying*' : '✅ *Instagram publisher recovered*'
      const resolved = await this.s.resolveAlert('tick', `${verdict} at ${when(now, now)}: ${outcomes.join('; ')}.`)
      if (resolved === false && !hasFailures) return // Keep the named recovery for the next clean tick.
    } else if (!hasFailures) {
      // A pre-upgrade alert may already be open with no recorded streak.
      await this.s.resolveAlert('tick', `✅ *Instagram publisher recovered* at ${when(now, now)}: the latest tick finished without errors.`)
    }
    if (previous.length || hasFailures) writeJson(this.file, this.current)
  }
}

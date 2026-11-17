/** The three approved formats: which days they cover, how many events they show, and when they draft and publish. */
import { addDays, baInstant, weekdayOf } from './format.ts'

export type FormatKey = 'hoy' | 'finde' | 'gratis'

export interface FormatSpec {
  key: FormatKey
  kind: 'story' | 'carousel'
  /** "Hoy story" etc., the name the Slack message uses. */
  slackName: string
  /** The weekday the run's first covered day falls on (null = every day). */
  startWeekday: number | null
  days: number
  max: number
  min: number
  freeOnly: boolean
  /** Hoy only: events must start at or after this Buenos Aires hour. */
  fromHour: number | null
  /** Include at least one free event when one qualifies. */
  wantsFree: boolean
}

export const FORMATS: Record<FormatKey, FormatSpec> = {
  hoy: { key: 'hoy', kind: 'story', slackName: 'Hoy story', startWeekday: null, days: 1, max: 4, min: 2, freeOnly: false, fromHour: 18, wantsFree: true },
  finde: { key: 'finde', kind: 'carousel', slackName: 'Este finde carousel', startWeekday: 5, days: 3, max: 6, min: 4, freeOnly: false, fromHour: null, wantsFree: true },
  gratis: { key: 'gratis', kind: 'carousel', slackName: 'Gratis esta semana carousel', startWeekday: 1, days: 7, max: 8, min: 5, freeOnly: true, fromHour: null, wantsFree: false },
}

export const isFormatKey = (value: string): value is FormatKey => value in FORMATS

export interface RunWindow {
  /** First and last covered Buenos Aires dates. */
  from: string
  to: string
  draftAt: Date
  publishAt: Date
  /** After this a draft without approval is skipped. */
  cutoff: Date
  /** No new Instagram write after this; only requests already issued are reconciled. Hoy 19:00, carousels the cutoff. */
  deadline: Date
}

/** The run that covers `from`, which must be the format's first day (any day for Hoy, a Friday, or a Monday). */
export function runWindow(format: FormatKey, from: string): RunWindow {
  const spec = FORMATS[format]
  if (spec.startWeekday !== null && weekdayOf(from) !== spec.startWeekday) {
    throw new Error(`${format} runs start on a ${spec.startWeekday === 5 ? 'Friday' : 'Monday'}; ${from} is not one`)
  }
  const to = addDays(from, spec.days - 1)
  switch (format) {
    case 'hoy': return { from, to, draftAt: baInstant(from, 11), publishAt: baInstant(from, 17), cutoff: baInstant(from, 17), deadline: baInstant(from, 19) }
    case 'finde': return { from, to, draftAt: baInstant(addDays(from, -2), 18), publishAt: baInstant(addDays(from, -1), 12), cutoff: baInstant(from, 18), deadline: baInstant(from, 18) }
    case 'gratis': return { from, to, draftAt: baInstant(addDays(from, -1), 18), publishAt: baInstant(from, 12), cutoff: baInstant(addDays(from, 1), 20), deadline: baInstant(addDays(from, 1), 20) }
  }
}

export const draftId = (format: FormatKey, from: string) => `${format}-${from}`

export function parseDraftId(id: string): { format: FormatKey; from: string } {
  const match = /^(hoy|finde|gratis)-(\d{4}-\d{2}-\d{2})$/.exec(id)
  if (!match) throw new Error(`Not a draft id: ${id} (expected e.g. finde-2026-11-20)`)
  return { format: match[1] as FormatKey, from: match[2]! }
}

/** Runs whose draft time has come and whose cutoff hasn't passed. */
export function activeRuns(format: FormatKey, now: Date): string[] {
  const today = new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(0, 10)
  const runs: string[] = []
  for (let offset = -8; offset <= 8; offset++) {
    const from = addDays(today, offset)
    const spec = FORMATS[format]
    if (spec.startWeekday !== null && weekdayOf(from) !== spec.startWeekday) continue
    const window = runWindow(format, from)
    if (window.draftAt <= now && now < window.cutoff) runs.push(from)
  }
  return runs
}

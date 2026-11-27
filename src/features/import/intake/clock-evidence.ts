// A bare dotted token with a possible month is ambiguous; an introducer or unit makes it a clock.
const clock = /(?:(?<introduced>(?<![\p{L}\d])a las? )|(?<delimiter>(?<=\p{L})[ \t\u00a0\u202f]*:[ \t\r\n\u00a0\u202f]*))?(?<![\p{L}\d])(?<!\d[.:/])(?<!\p{Sc}[ \t\u00a0\u202f]*)(?<hour>[01]?\d|2[0-4])(?:(?<separator>[:.])(?<minute>[0-5]\d))?(?:[ \t\u00a0\u202f]*(?<suffix>[ap]\.?[ \t\u00a0\u202f]*m\b\.?|(?:horas|hs?)\b))?(?![\p{L}\d]|[.:/]\d)/giu

export const normalizeEvidenceText = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim()

export const isClockRangeGap = (gap: string) => /^\s*(?:[-–—]|(?:a|hasta)(?: las?)?)\s*$/i.test(gap)

const explicitMinutes = (separator: string | undefined, minute: string | undefined) =>
  separator === ':' || separator === '.' && (minute === '00' || Number(minute) > 12)

type ClockOptions = { inferRangeStarts?: boolean }

function sharedRangeEnd(source: string, start: number, end: number, closing: RegExpMatchArray | undefined): number | undefined {
  if (!closing?.groups || closing.index === undefined) return
  const { introduced, delimiter, hour, separator, minute, suffix } = closing.groups
  const closingStart = closing.index + (introduced ?? delimiter ?? '').length
  if (!isClockRangeGap(source.slice(end, closingStart))) return
  const prefix = source.slice(0, start)
  // Don't read a numeric date fragment or "viernes 20 a las 21" as a range start.
  if (/\d[-–—]$/.test(prefix) || introduced && !/\b(?:de|desde)\s+$/i.test(prefix)) return
  if (hour === '24' && minute && minute !== '00') return
  // The end needs its own hour unit or unambiguous minutes. Never borrow AM/PM.
  if (suffix ? !/^h/i.test(suffix) : !explicitMinutes(separator, minute)) return
  return closing.index + closing[0].length
}

export function* clockTokens(source: string, { inferRangeStarts = true }: ClockOptions = {}) {
  const matches = [...source.matchAll(clock)]
  for (const [i, { 0: token, index, groups }] of matches.entries()) {
    if (!groups || groups.hour === '24') continue
    const { introduced, delimiter, separator, minute, suffix } = groups
    const start = index + (introduced ?? delimiter ?? '').length
    const end = index + token.length
    // A bare field value ("Puertas:21") needs a delimiter, not a particular label.
    const bareAfterColon = !!delimiter && !separator && !suffix && /^[ \t\u00a0\u202f]*(?:$|[\r\n.,;|/!?()])/u.test(source.slice(end))
    const standalone = suffix || introduced || explicitMinutes(separator, minute) || bareAfterColon
    const rangeEnd = !standalone && !separator && inferRangeStarts ? sharedRangeEnd(source, start, end, matches[i + 1]) : undefined
    if (!standalone && rangeEnd === undefined) continue
    const period = suffix?.[0].toLowerCase()
    let hours = Number(groups.hour)
    if (period === 'a' || period === 'p') {
      if (hours < 1 || hours > 12) continue
      hours = hours % 12 + (period === 'p' ? 12 : 0)
    }
    // Keep the token's own end for range-gap checks even when citing it requires the closing clock.
    yield { start, end, rangeEnd, bareAfterColon, time: `${String(hours).padStart(2, '0')}:${minute ?? '00'}` }
  }
}

/** Match clocks in the source first so a quote cannot cut the minutes, unit or meridiem. */
export function citesClock(excerpt: string, time: string, source = excerpt, count = 1, options?: ClockOptions): boolean {
  if (!excerpt) return false
  const tokens = [...clockTokens(source, options)]
  const matching = tokens.filter((token, index) => token.time === time && (count === 1 || index === 0 ||
    !isClockRangeGap(source.slice(tokens[index - 1].end, token.start))))
  for (let start = source.indexOf(excerpt); start !== -1; start = source.indexOf(excerpt, start + 1)) {
    if (matching.filter(token => token.start >= start && (token.rangeEnd ?? token.end) <= start + excerpt.length).length >= count) return true
  }
  return false
}

const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const namedMonth = months.map(month => `${month.slice(0, 3)}(?:${month.slice(3)})?`).join('|')
const calendarDate = new RegExp(String.raw`(?<![\p{L}\d])(?<!\d[./-])(?:` +
  String.raw`(?<isoYear>\d{4})-(?<isoMonth>\d{2})-(?<isoDay>\d{2})|(?<day>\d{1,2})(?:(?<sep>[./])(?<month>\d{1,2})(?:\k<sep>(?<year>\d{4}))?| +(?:de +)?(?<monthName>${namedMonth})(?: +(?:de(?:l)? +)?(?<namedYear>\d{4}))?))(?![\p{L}\d]|[./-]\d)`, 'gu')

/** Check that the quote contains the local date and a separate clock, not sale wording. */
export function citesDateAndClock(excerpt: string, date: string, time: string): boolean {
  const text = excerpt.toLowerCase()
  const [year, month, day] = date.split('-').map(Number)
  return [...text.matchAll(calendarDate)].some(({ 0: token, index, groups }) => {
    if (!groups) return false
    const { isoYear, isoMonth, isoDay, day: numericDay, month: numericMonth, year: numericYear, monthName, namedYear } = groups
    const statedYear = isoYear ?? numericYear ?? namedYear
    const statedMonth = monthName ? months.findIndex(value => value.startsWith(monthName)) + 1 : Number(isoMonth ?? numericMonth)
    return Number(isoDay ?? numericDay) === day && statedMonth === month && (!statedYear || Number(statedYear) === year) &&
      citesClock(`${text.slice(0, index)}\n${text.slice(index + token.length)}`, time)
  })
}

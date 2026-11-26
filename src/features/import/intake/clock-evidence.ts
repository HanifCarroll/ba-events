// A bare dotted token with a possible month is ambiguous; an introducer or unit makes it a clock.
const clock = /(?:(?<introduced>(?<![\p{L}\d])a las? )|(?<delimiter>(?<=\p{L})[ \t\u00a0\u202f]*:[ \t\r\n\u00a0\u202f]*))?(?<![\p{L}\d])(?<!\d[.:/])(?<hour>[01]?\d|2[0-3])(?:(?<separator>[:.])(?<minute>[0-5]\d))?(?:[ \t\u00a0\u202f]*(?<suffix>[ap]\.?[ \t\u00a0\u202f]*m\b\.?|(?:horas|hs?)\b))?(?![\p{L}\d]|[.:/]\d)/giu

export const normalizeEvidenceText = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim()

export const isClockRangeGap = (gap: string) => /^\s*(?:[-–—]|(?:a|hasta)(?: las?)?)\s*$/i.test(gap)

export function* clockTokens(source: string) {
  for (const { 0: token, index, groups } of source.matchAll(clock)) {
    if (!groups) continue
    const { introduced, delimiter, separator, minute, suffix } = groups
    const end = index + token.length
    // A bare field value ("Puertas:21") needs a delimiter, not a particular label.
    const bareAfterColon = !!delimiter && !separator && !suffix && /^[ \t\u00a0\u202f]*(?:$|[\r\n.,;|/!?()])/u.test(source.slice(end))
    const unambiguousDot = separator === '.' && (minute === '00' || Number(minute) > 12)
    if (!(suffix || introduced || separator === ':' || unambiguousDot || bareAfterColon)) continue
    const period = suffix?.[0].toLowerCase()
    let hours = Number(groups.hour)
    if (period === 'a' || period === 'p') {
      if (hours < 1 || hours > 12) continue
      hours = hours % 12 + (period === 'p' ? 12 : 0)
    }
    yield { start: index + (introduced ?? delimiter ?? '').length, end, bareAfterColon,
      time: `${String(hours).padStart(2, '0')}:${minute ?? '00'}` }
  }
}

/** Match clocks in the source first so a quote cannot cut the minutes, unit or meridiem. */
export function citesClock(excerpt: string, time: string, source = excerpt, count = 1): boolean {
  if (!excerpt) return false
  const tokens = [...clockTokens(source)]
  const matching = tokens.filter((token, index) => token.time === time && (count === 1 || index === 0 ||
    !isClockRangeGap(source.slice(tokens[index - 1].end, token.start))))
  for (let start = source.indexOf(excerpt); start !== -1; start = source.indexOf(excerpt, start + 1)) {
    if (matching.filter(token => token.start >= start && token.end <= start + excerpt.length).length >= count) return true
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

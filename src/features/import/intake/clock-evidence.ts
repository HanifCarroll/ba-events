// A bare dotted token with a possible month is ambiguous; an introducer or unit makes it a clock.
const clock = /(?:(?<introduced>(?<![\p{L}\d])a las? )|(?<delimiter>(?<=\p{L})[ \t\u00a0\u202f]*:[ \t\r\n\u00a0\u202f]*))?(?<![\p{L}\d])(?<!\d[.:/])(?<hour>[01]?\d|2[0-4])(?:(?<separator>[:.])(?<minute>[0-5]\d))?(?:[ \t\u00a0\u202f]*(?<suffix>[ap]\.?[ \t\u00a0\u202f]*m\b\.?|(?:horas|hs?)\b))?(?![\p{L}\d]|[.:/]\d)/giu

export const normalizeEvidenceText = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim()

const explicitMinutes = (separator: string | undefined, minute: string | undefined) =>
  separator === ':' || separator === '.' && (minute === '00' || Number(minute) > 12)

const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const shortMonths = months.map(month => month.slice(0, 3)).join('|')
const namedMonth = months.map(month => `${month.slice(0, 3)}(?:${month.slice(3)})?`).join('|')
const monthCues = `${namedMonth}|sept|set(?:iembre)?`
export const SPANISH_WEEKDAYS = 'lun(?:es)?|mar(?:tes)?|mie(?:r(?:c(?:oles)?)?)?|jue(?:v(?:es)?)?|vie(?:r(?:nes)?)?|sab(?:ado)?|dom(?:ingo)?'
const shortWeekdays = 'lun|mar|mie(?:r(?:c)?)?|juev?|vier?|sab|dom'
const dayPrefix = new RegExp(String.raw`\b(?:(?:el|dia|al|del|${SPANISH_WEEKDAYS}|${monthCues})[,:]?|(?:${shortWeekdays}|${shortMonths}|sept|set)\.)(?: el)?$`)
const completedDatePrefix = new RegExp(String.raw`\b\d{1,2} (?:de )?(?:${monthCues}) *[,:]$`)
const currency = String.raw`\p{Sc}|\b(?:ars|usd|u\$s|pesos?|dolar(?:es)?)\b`
const nonClockPrefix = new RegExp(String.raw`(?:${currency}|\b(?:precios?|costos?|tarifas?|duran?|duracion)(?: (?:estimad[ao]|aproximad[ao]|aproximadamente))? *[:=]?(?: (?:de|desde|entre)(?: las?)?)?)$`, 'u')
const currencySuffix = new RegExp(String.raw`^(?:\( *)?(?:en )?(?:${currency})`, 'u')
const durationSuffix = /^\.? *de duracion\b/u

function clockLexemes(source: string) {
  return [...source.matchAll(clock)].flatMap(({ 0: token, index, groups }) => {
    if (!groups) return []
    const { introduced, delimiter, hour, separator, minute, suffix } = groups
    const start = index + (introduced ?? delimiter ?? '').length
    const end = index + token.length
    // Context labels are local to the number and cannot extend onto another line.
    const prefix = normalizeEvidenceText(source.slice(Math.max(0, start - 80), start).split(/[\r\n]/u).at(-1) ?? '')
    const tail = normalizeEvidenceText(source.slice(end, end + 80).split(/[\r\n]/u, 1)[0])
    const period = suffix?.[0].toLowerCase()
    const meridiem = period === 'a' || period === 'p'
    const hourUnit = period === 'h'
    // A trailing price can qualify a bare number, not a clock with its own time marker.
    const nonClock = nonClockPrefix.test(prefix) || durationSuffix.test(tail) ||
      !hourUnit && !meridiem && separator !== ':' && currencySuffix.test(tail)
    const dateFragmentOrRating = /(?:\+|\d *[./–—-])$/.test(prefix)
    const hasDayPrefix = dayPrefix.test(prefix) && !completedDatePrefix.test(prefix)
    // A bare field value ("Puertas:21") needs a delimiter, not a particular label.
    const bareAfterColon = !!delimiter && !separator && !suffix && /^[ \t\u00a0\u202f]*(?:$|[\r\n.,;|/!?()])/u.test(source.slice(end))
    const hours = Number(hour)
    const validStart = hours < 24 && (!meridiem || hours >= 1 && hours <= 12)
    const localHour = meridiem ? hours % 12 + (period === 'p' ? 12 : 0) : hours
    return [{ start, end, bareAfterColon, nonClock, meridiem, hasDayPrefix,
      time: `${String(localHour).padStart(2, '0')}:${minute ?? '00'}`,
      standalone: validStart && Boolean(suffix || introduced || explicitMinutes(separator, minute) || bareAfterColon),
      sharedStart: validStart && !separator && !suffix && !dateFragmentOrRating,
      sharedEnd: !meridiem && (hourUnit || separator === ':') && (hours < 24 || !minute || minute === '00'),
    }]
  })
}

export function* clockTokens(source: string) {
  const tokens = clockLexemes(source)
  const ranges = tokens.map((left, index) => {
    const right = tokens[index + 1]
    if (!right) return
    const gap = source.slice(left.end, right.start).trim().toLowerCase()
    const wordJoin = gap === 'a' || gap === 'hasta'
    const dashJoin = gap === '-' || gap === '–'
    // `al` and `a la(s)` are never range joins. Day words only disqualify a bare number before a dash.
    if (!wordJoin && !dashJoin) return
    const bareStart = left.sharedStart && (wordJoin || !left.hasDayPrefix)
    if (left.nonClock || right.nonClock) return 'non-clock'
    if (left.standalone && (right.standalone || right.sharedEnd) || bareStart && right.sharedEnd) return 'clock'
    if (bareStart && right.standalone && right.meridiem) return 'ambiguous-meridiem'
  })
  for (const [index, { start, end, time, standalone, bareAfterColon, nonClock }] of tokens.entries()) {
    const previousRange = ranges[index - 1]
    if (nonClock || previousRange === 'non-clock' || ranges[index] === 'non-clock') continue
    const borrowsEnd = !standalone && ranges[index] === 'clock'
    if (!standalone && !borrowsEnd) continue
    const evidenceEnd = borrowsEnd ? tokens[index + 1].end : end
    const closesRange = previousRange === 'clock' || previousRange === 'ambiguous-meridiem'
    yield { start, end, time, evidenceEnd, bareAfterColon, closesRange }
  }
}

/** Match clocks in the source first so a quote cannot cut the minutes, unit or meridiem. */
export function citesClock(excerpt: string, time: string, source = excerpt, count = 1): boolean {
  if (!excerpt) return false
  const matching = [...clockTokens(source)].filter(token => token.time === time && !token.closesRange)
  for (let start = source.indexOf(excerpt); start !== -1; start = source.indexOf(excerpt, start + 1)) {
    if (matching.filter(token => token.start >= start && token.evidenceEnd <= start + excerpt.length).length >= count) return true
  }
  return false
}

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
    // Removing the date must not join two numbers across it into a clock range.
    return Number(isoDay ?? numericDay) === day && statedMonth === month && (!statedYear || Number(statedYear) === year) &&
      citesClock(`${text.slice(0, index)}\n#\n${text.slice(index + token.length)}`, time)
  })
}

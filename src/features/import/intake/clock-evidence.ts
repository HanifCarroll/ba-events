// Dots are also date separators: a dotted clock needs a suffix or an explicit introduction.
const clock = /(?<![\p{L}\d])(?<!\d[.:/])(?<introduced>a las? )?(?<hour>[01]?\d|2[0-3])(?:(?<separator>[:.])(?<minute>[0-5]\d))?(?:[ \t\u00a0\u202f]*(?<suffix>[ap]\.?[ \t\u00a0\u202f]*m\b\.?|(?:horas|hs?)\b))?(?![\p{L}\d]|[.:/]\d)/giu

export const ENTRY_LABEL = String.raw`(?:abrimos (?:las )?puertas?|(?:las )?puertas? abren|apertura(?: de puertas?)?|puertas?|ingreso|acceso|doors?)`
export const APPROXIMATE = String.raw`(?:aprox(?:imadamente)?\.?|cerca de|alrededor de|mas o menos)`
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ')
const entryBefore = new RegExp(String.raw`\b${ENTRY_LABEL}(?: *[:–—-] *| +)(?:a las? )?$`)
const entryAfter = new RegExp(String.raw`^\.? *(?:\( *${ENTRY_LABEL} *\)|[:–—-] *${ENTRY_LABEL}(?= *[.;,|!?]| *$))`)
const approximateBefore = new RegExp(String.raw`\b${APPROXIMATE}[,)]?(?: (?:a )?las?)? $`)
const approximateAfter = new RegExp(String.raw`^\.? *[,(:–—-]? *${APPROXIMATE}(?![\p{L}\d])`, 'u')
const durationAmount = String.raw`\d+(?:[.,]\d+)? +(?:horas?|min(?:utos?|s)?\.?)\b`
const duration = new RegExp(`^${durationAmount}`)
const durationTail = new RegExp(String.raw`^\.? *(?:\( *${APPROXIMATE} ${durationAmount} *\)|,? *${APPROXIMATE} ${durationAmount})\.?$`)
const restOfLine = (text: string) => text.split(/\r\n?|\n/u, 1)[0]

export const isEntryClock = (before: string, after: string) => entryBefore.test(fold(before)) || entryAfter.test(fold(restOfLine(after)))
export const isApproximateDuration = (before: string, amount: string) => approximateBefore.test(fold(before)) && duration.test(fold(amount))
export const isApproximateDurationTail = (tail: string) => durationTail.test(fold(tail))
export function isApproximateClock(before: string, after: string): boolean {
  if (approximateBefore.test(fold(before))) return true
  const tail = fold(restOfLine(after))
  const qualifier = approximateAfter.exec(tail)
  return !!qualifier && !duration.test(tail.slice(qualifier[0].length).trimStart())
}

// The hour in a caption such as "Ingreso a las 21" (or "Puertas: 21") has an explicit role without a unit.
export function* clockTokens(source: string, { allowIntroducedHour = false, allowEntryHour = false } = {}) {
  for (const { 0: token, index, groups } of source.matchAll(clock)) {
    if (!groups) continue
    const start = index + (groups.introduced?.length ?? 0)
    if (!(groups.suffix || groups.separator === ':' || allowIntroducedHour && groups.introduced ||
      allowEntryHour && !groups.separator && isEntryClock(source.slice(0, start), source.slice(index + token.length)))) continue
    const period = groups.suffix?.[0].toLowerCase()
    let hours = Number(groups.hour)
    if (period === 'a' || period === 'p') {
      if (hours < 1 || hours > 12) continue
      hours = hours % 12 + (period === 'p' ? 12 : 0)
    }
    yield { start, end: index + token.length, time: `${String(hours).padStart(2, '0')}:${groups.minute ?? '00'}` }
  }
}

/** Match clocks in the source first, then check that a single quote contains the complete tokens. */
export function citesClock(excerpt: string, time: string, source = excerpt, count = 1, role?: 'start' | 'doors' | 'entry'): boolean {
  if (!excerpt) return false
  const tokens = [...clockTokens(source, { allowEntryHour: role === 'doors' || role === 'entry' })].filter(token => {
    if (token.time !== time) return false
    if (!role) return true
    const before = source.slice(0, token.start), after = source.slice(token.end)
    if (isApproximateClock(before, after)) return false
    return role === 'doors' || isEntryClock(before, after) === (role === 'entry')
  })
  for (let start = source.indexOf(excerpt); start !== -1; start = source.indexOf(excerpt, start + 1)) {
    if (tokens.filter(token => token.start >= start && token.end <= start + excerpt.length).length >= count) return true
  }
  return false
}

/** A caption can explicitly assign otherwise unlabeled flyer clocks to entry. */
export function captionLabelsFlyerDoors(caption: string): boolean {
  return /\bhorarios? (?:indicados? |publicados? |que figuran? )?(?:del|(?:de|en) (?:los|las|el|la)) (?:flyers?|afiches?|placas?) (?:son|es|corresponden?) (?:(?:el|los) )?(?:horarios? )?(?:de|del|a|al) (?:(?:la|las|el|los) )?(?:ingresos?|aperturas?|puertas?)\b/.test(fold(caption))
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

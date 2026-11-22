// Dots are also date separators: a dotted clock needs an explicit hours or AM/PM suffix.
const clock = /(?<![\p{L}\d])(?<!\d[.:/])(?<hour>[01]?\d|2[0-3])(?:(?<separator>[:.])(?<minute>[0-5]\d))?(?:[ \t]*(?<suffix>[ap]\.?[ \t]*m\b\.?|(?:horas|hs?)\b))?(?![\p{L}\d]|[.:/]\d)/gu

/** Find complete clock tokens without interpreting what they describe. */
export function quotedClocks(excerpt: string): string[] {
  return [...excerpt.toLowerCase().matchAll(clock)].flatMap(({ groups }) => {
    if (!groups || (!groups.suffix && groups.separator !== ':')) return []
    const period = groups.suffix?.[0]
    let hours = Number(groups.hour)
    if (period === 'a' || period === 'p') {
      if (hours < 1 || hours > 12) return []
      hours = hours % 12 + (period === 'p' ? 12 : 0)
    }
    return [`${String(hours).padStart(2, '0')}:${groups.minute ?? '00'}`]
  })
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
      quotedClocks(`${text.slice(0, index)}\n${text.slice(index + token.length)}`).includes(time)
  })
}

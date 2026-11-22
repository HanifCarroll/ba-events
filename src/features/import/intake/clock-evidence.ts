const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const doors = String.raw`(?:puertas?|apertura(?: de puertas)?|ingreso|acceso|abren?|doors?)`
const show = String.raw`(?:show|inicio|funcion|comienza|comienzo|empieza|arranca|start)`
const suffix = String.raw`(?:[ap]\.?m\b\.?|hs?\b|horas\b)`
const clock = String.raw`(?<clock>(?<![\p{L}\d])(?<!\d[:.])(?<hour>[01]?\d|2[0-3])(?:[:.](?<minutes>[0-5]\d)(?:\s*(?<minuteSuffix>${suffix}))?|\s*(?<hourSuffix>${suffix}))(?!\d|[:.]\d))`
const gap = String.raw`\s*:?\s*(?:(?:a las?|desde las?)\s+)?`
const roleLabel = new RegExp(String.raw`\b(?:${doors}|${show})\b`, 'u')
const labeledClock = new RegExp(String.raw`\b(?:(?<door>${doors})|${show})\b${gap}${clock}`, 'gu')
const anyClock = new RegExp(clock, 'gu')

function clockTime(groups: Record<string, string> | undefined): string | undefined {
  if (!groups?.hour) return
  const { hour, minutes = '00', minuteSuffix, hourSuffix } = groups
  const period = (minuteSuffix ?? hourSuffix)?.[0]
  let hours = Number(hour)
  if (period === 'a' || period === 'p') {
    if (hours < 1 || hours > 12) return
    hours = hours % 12 + (period === 'p' ? 12 : 0)
  }
  return `${String(hours).padStart(2, '0')}:${minutes}`
}

/** Only clocks inside the quote count, but their roles come from the untrimmed source lines. */
function supportsClock(role: 'start' | 'doors', excerpt: string, time: string, caption = excerpt): boolean {
  const source = fold(caption), quote = fold(excerpt)
  if (!quote) return false
  const clocks = [...source.matchAll(/[^\r\n]+/gu)].flatMap(({ 0: line, index }) => {
    const labeled = roleLabel.test(line)
    if (role === 'doors' && !labeled) return []
    return [...line.matchAll(labeled ? labeledClock : anyClock)].flatMap(match => {
      const groups = match.groups
      if (!groups || Boolean(groups.door) !== (role === 'doors')) return []
      const end = index + match.index + match[0].length
      return [{ start: end - groups.clock.length, end, time: clockTime(groups) }]
    })
  })
  let found = false
  for (let start = source.indexOf(quote); start !== -1; start = source.indexOf(quote, start + 1)) {
    const cited = clocks.filter(clock => clock.start >= start && clock.end <= start + quote.length)
    if (!cited.length || cited.some(clock => clock.time !== time)) return false
    found = true
  }
  return found
}

export const statesDoorsTime = (excerpt: string, time: string, caption?: string) => supportsClock('doors', excerpt, time, caption)
export const supportsStartTime = (excerpt: string, time: string, caption?: string) => supportsClock('start', excerpt, time, caption)

const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const namedMonth = months.map(month => `${month.slice(0, 3)}(?:${month.slice(3)})?`).join('|')
const saleOpening = /\b(?:(?:entradas|tickets|venta|preventa)\s+(?:(?:a la venta|on sale)\s+)?(?:desde|a partir del?|from)|a la venta\s+desde|tickets go on sale(?: on)?)\s+(?:el\s+)?/gu
const saleDate = new RegExp(String.raw`^(?:(?:lun(?:es)?|mar(?:tes)?|mie(?:rcoles)?|jue(?:ves)?|vie(?:rnes)?|sab(?:ado)?|dom(?:ingo)?)[,.]? +)?(?:` +
  String.raw`(?<isoYear>\d{4})-(?<isoMonth>\d{2})-(?<isoDay>\d{2})|(?<day>\d{1,2})(?:\/(?<month>\d{1,2})(?:\/(?<year>\d{4}))?| +(?:de +)?(?<monthName>${namedMonth})(?: +(?:de(?:l)? +)?(?<namedYear>\d{4}))?))\b`, 'u')
const saleClock = new RegExp(String.raw`^\s*,?\s*(?:(?:a las?|at)\s+)?${clock}`, 'u')

/** Require a calendar date and a clock immediately after an explicit sale-opening phrase. */
export function statesSaleOpening(excerpt: string, date: string, time: string): boolean {
  const text = fold(excerpt).replace(/\s+/gu, ' ')
  const [year, month, day] = date.split('-').map(Number)
  const stated = [...text.matchAll(saleOpening)]
  return stated.length === 1 && stated.every(({ 0: label, index }) => {
    const afterLabel = text.slice(index + label.length)
    const match = saleDate.exec(afterLabel)
    if (!match?.groups) return false
    const { isoYear, isoMonth, isoDay, day: numericDay, month: numericMonth, year: numericYear, monthName, namedYear } = match.groups
    const statedYear = isoYear ?? numericYear ?? namedYear
    const statedMonth = monthName ? months.findIndex(value => value.startsWith(monthName)) + 1 : Number(isoMonth ?? numericMonth)
    const statedTime = clockTime(saleClock.exec(afterLabel.slice(match[0].length))?.groups)
    return Number(isoDay ?? numericDay) === day && statedMonth === month && (!statedYear || Number(statedYear) === year) && statedTime === time
  })
}

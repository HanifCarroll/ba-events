const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const doors = String.raw`(?:puertas?|apertura(?: de puertas)?|ingreso|acceso|abren?|doors?)`
const show = String.raw`(?:show|inicio|funcion|comienza|start)`
const clock = String.raw`([01]?\d|2[0-3])(?:[:.]([0-5]\d)(?:\s*(?:hs?|horas)\b)?|\s*(?:hs?|horas)\b)(?!\d|[:.]\d)`
const gap = String.raw`\s*:?\s*(?:(?:a las?|desde las?)\s+)?`
const labeled = (label: string) => new RegExp(String.raw`\b${label}\b${gap}${clock}`, 'gu')
const doorClocks = labeled(doors)
const showClocks = labeled(show)
const getClocks = (text: string, pattern: RegExp) => [...fold(text).matchAll(pattern)]
  .map(([, hour, minutes = '00']) => `${hour.padStart(2, '0')}:${minutes}`)
const exactly = (clocks: string[], value: string) => clocks.length > 0 && clocks.every(clock => clock === value)

export const statesDoorsTime = (excerpt: string, time: string) => exactly(getClocks(excerpt, doorClocks), time)

/** A quote cannot borrow a doors clock as a show start, even if it cuts the doors label from the same caption line. */
export function supportsStartTime(excerpt: string, time: string, caption?: string): boolean {
  const quoted = fold(excerpt).replace(/\s+/gu, ' ')
  const relevantLines = caption?.split(/\r?\n/u).filter(line => fold(line).replace(/\s+/gu, ' ').includes(quoted)) ?? []
  const showTimes = getClocks(excerpt, showClocks)
  const doorContext = [excerpt, ...relevantLines].some(line => getClocks(line, doorClocks).length)
  return showTimes.length || doorContext ? exactly(showTimes, time) : true
}

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
    const [, hours, minutes = '00'] = saleClock.exec(afterLabel.slice(match[0].length)) ?? []
    return Number(isoDay ?? numericDay) === day && statedMonth === month && (!statedYear || Number(statedYear) === year) &&
      hours !== undefined && `${hours.padStart(2, '0')}:${minutes}` === time
  })
}

/** Spanish dates, times, prices, and titles for the Instagram formats (copy.md "Shared pieces"). Buenos Aires is UTC−3 all year. */

const BA_OFFSET_MS = 3 * 60 * 60 * 1000

export const WEEKDAYS_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'] as const
export const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
export const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const
export const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const
const NUMBERS_ES = ['Cero', 'Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho']
const NUMBERS_EN = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight']

/** A Buenos Aires wall-clock reading of an instant. */
export interface LocalTime { date: string; weekday: number; day: number; month: number; hour: number; minute: number }

export function baLocal(instant: Date | string): LocalTime {
  const shifted = new Date(new Date(instant).getTime() - BA_OFFSET_MS)
  return {
    date: shifted.toISOString().slice(0, 10),
    weekday: shifted.getUTCDay(),
    day: shifted.getUTCDate(),
    month: shifted.getUTCMonth(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  }
}

/** The UTC instant of a Buenos Aires wall-clock time on a YYYY-MM-DD date. */
export function baInstant(date: string, hour: number, minute = 0): Date {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + (hour * 60 + minute) * 60_000 + BA_OFFSET_MS)
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay()
}

const pad = (n: number) => String(n).padStart(2, '0')
export const hhmm = (t: LocalTime) => `${pad(t.hour)}:${pad(t.minute)}`

/** "21:00", or "11:00 a 16:30" when the end is later the same Buenos Aires day. */
export function timeLabel(startsAt: string, endsAt: string | null): string {
  const start = baLocal(startsAt)
  if (!endsAt) return hhmm(start)
  const end = baLocal(endsAt)
  return end.date === start.date && Date.parse(endsAt) > Date.parse(startsAt) ? `${hhmm(start)} a ${hhmm(end)}` : hhmm(start)
}

/** "Viernes 20". */
export const weekdayDay = (date: string) => `${WEEKDAYS_ES[weekdayOf(date)]} ${Number(date.slice(8, 10))}`

/** "Miércoles 18 de noviembre". */
export const longDate = (date: string) => `${weekdayDay(date)} de ${MONTHS_ES[Number(date.slice(5, 7)) - 1]}`

/** "20 al 22 de noviembre", or "28 de noviembre al 4 de diciembre" across a month change. */
export function dateRange(from: string, to: string): string {
  const [d1, m1, d2, m2] = [Number(from.slice(8, 10)), Number(from.slice(5, 7)) - 1, Number(to.slice(8, 10)), Number(to.slice(5, 7)) - 1]
  return m1 === m2 ? `${d1} al ${d2} de ${MONTHS_ES[m1]}` : `${d1} de ${MONTHS_ES[m1]} al ${d2} de ${MONTHS_ES[m2]}`
}

/** English dates for Hanif's Slack message: "November 18", "November 20 to 22", "November 28 to December 4". */
export function englishDates(from: string, to: string, style: 'long' | 'compact' = 'long'): string {
  const [d1, m1, d2, m2] = [Number(from.slice(8, 10)), Number(from.slice(5, 7)) - 1, Number(to.slice(8, 10)), Number(to.slice(5, 7)) - 1]
  const month = (index: number) => style === 'compact' ? MONTHS_EN[index]!.slice(0, 3) : MONTHS_EN[index]
  const start = `${month(m1)} ${d1}`
  if (from === to) return start
  return `${start}${style === 'compact' ? '–' : ' to '}${m1 === m2 ? d2 : `${month(m2)} ${d2}`}`
}

export function numberWord(n: number, lang: 'es' | 'en'): string {
  const words = lang === 'es' ? NUMBERS_ES : NUMBERS_EN
  return words[n] ?? String(n)
}

export type PriceInput = { isFree: boolean; price: number | null; payWhatYouWant: boolean }

/** The pill text, or null when there is no pill. Never a range or a guess. */
export function priceLabel({ isFree, price, payWhatYouWant }: PriceInput): string | null {
  if (isFree) return 'Gratis'
  if (price !== null && price > 0) return `$${Math.round(price).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
  if (payWhatYouWant) return 'A la gorra'
  return null
}

/** Small words that stay lowercase in a title-cased title, unless they come first. */
const SMALL_WORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'a', 'al', 'con', 'por', 'para', 'o', 'u', 'the', 'of', 'and', 'an', 'in', 'on'])

/**
 * Titles stay as the catalog has them, except an all-uppercase title becomes title case: each word capitalized, small
 * words lowercase unless first, and words of one or two letters (other than the small words) or with digits kept as written (DJ, FEJA 2026 → Feja 2026).
 */
export function displayTitle(name: string): string {
  const title = name.trim()
  const letters = title.replace(/[^\p{L}]/gu, '')
  if (!letters || letters !== letters.toLocaleUpperCase('es') || letters === letters.toLocaleLowerCase('es')) return title
  let first = true
  return title.replace(/[\p{L}\p{N}'’]+/gu, word => {
    const isFirst = first
    first = false
    const bare = word.replace(/['’]/g, '')
    if (/\p{N}/u.test(word) || bare.length <= 2 && !SMALL_WORDS.has(bare.toLocaleLowerCase('es'))) return word
    const lower = word.toLocaleLowerCase('es')
    if (!isFirst && SMALL_WORDS.has(lower)) return lower
    return lower.replace(/\p{L}/u, c => c.toLocaleUpperCase('es'))
  })
}

/** The first sentence of the Spanish summary when it is 90 characters or fewer. */
export function descriptionLine(summary: string | null): string | null {
  const text = summary?.trim()
  if (!text) return null
  const match = /^.+?[.!?…](?=\s|$)/su.exec(text)
  const sentence = (match ? match[0] : text).trim()
  return sentence.length <= 90 ? sentence : null
}

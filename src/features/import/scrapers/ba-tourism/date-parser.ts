/**
 * Spanish Date Parser for BA Tourism Events
 *
 * Parses various Spanish date/time formats into structured dates.
 */

import {
  setHours,
  setMinutes,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  getDay,
  setDate,
  getMonth,
  getYear,
  isBefore,
  addMonths,
} from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import type { ParsedDateTime, WeekContext } from './types.ts'
import { BA_TIMEZONE } from '#shared/lib/constants.ts'

// Spanish day names (lowercase)
const SPANISH_DAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miércoles: 3,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sábado: 6,
  sabado: 6,
  sábados: 6,
  sabados: 6,
  domingos: 0,
}

// Spanish month names (lowercase)
const SPANISH_MONTHS: Record<string, number> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
}

/**
 * Parse time string like "20 h.", "20:30 h.", "10 a 21 h."
 * Returns { startTime, endTime } in "HH:mm" format
 */
function parseTimeRange(text: string): { startTime: string | null; endTime: string | null } {
  // Match "de X a Y h." pattern
  const rangeMatch = text.match(/de\s+(\d{1,2})(?::(\d{2}))?\s+a\s+(\d{1,2})(?::(\d{2}))?\s*h/i)
  if (rangeMatch) {
    const startHour = rangeMatch[1].padStart(2, '0')
    const startMin = rangeMatch[2] || '00'
    const endHour = rangeMatch[3].padStart(2, '0')
    const endMin = rangeMatch[4] || '00'
    return {
      startTime: `${startHour}:${startMin}`,
      endTime: `${endHour}:${endMin}`,
    }
  }

  // Match single time "20 h." or "20:30 h."
  const singleMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*h\.?/i)
  if (singleMatch) {
    const hour = singleMatch[1].padStart(2, '0')
    const min = singleMatch[2] || '00'
    return {
      startTime: `${hour}:${min}`,
      endTime: null,
    }
  }

  return { startTime: null, endTime: null }
}

/**
 * Extract day numbers from text like "23", "26, sábado 27 y domingo 28"
 */
function extractDayNumbers(text: string): number[] {
  const days: number[] = []

  // Match patterns like "martes 23" or just "23"
  const dayPattern = /(?:lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bados?|domingos?)\s+(\d{1,2})|(?:^|\s|,)(\d{1,2})(?:\s|,|$|y)/gi
  let match
  while ((match = dayPattern.exec(text)) !== null) {
    const day = parseInt(match[1] || match[2], 10)
    if (day >= 1 && day <= 31 && !days.includes(day)) {
      days.push(day)
    }
  }

  // Also look for standalone numbers after "y"
  const yPattern = /y\s+(\d{1,2})/gi
  while ((match = yPattern.exec(text)) !== null) {
    const day = parseInt(match[1], 10)
    if (day >= 1 && day <= 31 && !days.includes(day)) {
      days.push(day)
    }
  }

  return days.sort((a, b) => a - b)
}

/**
 * Get specific weekdays mentioned in text
 */
function extractWeekdays(text: string): number[] {
  const days: number[] = []
  const lowerText = text.toLowerCase()

  for (const [name, dayNum] of Object.entries(SPANISH_DAYS)) {
    if (lowerText.includes(name)) {
      if (!days.includes(dayNum)) {
        days.push(dayNum)
      }
    }
  }

  return days.sort((a, b) => a - b)
}

/**
 * Resolve a day number to an actual date within the week context
 */
function resolveDayToDate(dayNum: number, weekContext: WeekContext, referenceDate: Date): Date {
  // Try current month first
  let result = setDate(referenceDate, dayNum)

  // If that puts us before the week start, try next month
  if (isBefore(result, weekContext.startDate)) {
    result = setDate(addMonths(referenceDate, 1), dayNum)
  }

  return result
}

/**
 * Parse the week context from page header
 * Example: "Desde el lunes 29 al domingo 4 de enero"
 */
export function parseWeekContext(headerText: string, referenceDate: Date = new Date()): WeekContext {
  // Try to match "Desde el lunes X al domingo Y de MONTH"
  const match = headerText.match(
    /desde\s+el\s+\w+\s+(\d{1,2})\s+al\s+\w+\s+(\d{1,2})\s+de\s+(\w+)/i
  )

  if (match) {
    const startDay = parseInt(match[1], 10)
    const endDay = parseInt(match[2], 10)
    const monthName = match[3].toLowerCase()
    const month = SPANISH_MONTHS[monthName]

    if (month !== undefined) {
      let year = getYear(referenceDate)

      // If month is before current month, it's probably next year
      if (month < getMonth(referenceDate) - 1) {
        year++
      }

      // Handle year boundary (e.g., Dec 29 to Jan 4)
      const startDate = new Date(year, startDay > endDay ? month - 1 : month, startDay)
      const endDate = new Date(year, month, endDay)

      // Adjust if start is after end (year boundary)
      if (isBefore(endDate, startDate)) {
        return {
          startDate,
          endDate: new Date(year + 1, month, endDay),
        }
      }

      return { startDate, endDate }
    }
  }

  // Fallback to current week
  return {
    startDate: startOfWeek(referenceDate, { weekStartsOn: 1 }),
    endDate: endOfWeek(referenceDate, { weekStartsOn: 1 }),
  }
}

/**
 * Parse Spanish date text into structured dates
 *
 * Handles patterns like:
 * - "Martes 23, 20 h."
 * - "Viernes 26, sábado 27 y domingo 28, 20 h."
 * - "Todos los días, de 9 a 21 h."
 * - "Sábados y feriados, de 17 a 20 h."
 * - "Del jueves al domingo, 20 h."
 * - "Diciembre"
 */
export function parseSpanishDate(
  text: string,
  weekContext: WeekContext,
  referenceDate: Date = new Date()
): ParsedDateTime[] {
  const results: ParsedDateTime[] = []
  const lowerText = text.toLowerCase()
  const { startTime, endTime } = parseTimeRange(text)

  // Pattern 1: "Todos los días" - daily for the current week
  if (lowerText.includes('todos los días') || lowerText.includes('todos los dias')) {
    const weekDays = eachDayOfInterval({ start: weekContext.startDate, end: weekContext.endDate })
    for (const day of weekDays) {
      results.push({ date: day, startTime, endTime })
    }
    return results
  }

  // Pattern 2: Specific day numbers (e.g., "Martes 23, 20 h.")
  const dayNumbers = extractDayNumbers(text)
  if (dayNumbers.length > 0) {
    for (const dayNum of dayNumbers) {
      const date = resolveDayToDate(dayNum, weekContext, referenceDate)
      results.push({ date, startTime, endTime })
    }
    return results
  }

  // Pattern 3: Weekday names only (e.g., "Sábados y domingos, de 10 a 18 h.")
  const weekdays = extractWeekdays(text)
  if (weekdays.length > 0) {
    const weekDays = eachDayOfInterval({ start: weekContext.startDate, end: weekContext.endDate })
    for (const day of weekDays) {
      if (weekdays.includes(getDay(day))) {
        results.push({ date: day, startTime, endTime })
      }
    }
    return results
  }

  // Pattern 4: "Del X al Y" range with weekday names
  const rangeMatch = lowerText.match(/del\s+(\w+)\s+al\s+(\w+)/)
  if (rangeMatch) {
    const startDayName = rangeMatch[1]
    const endDayName = rangeMatch[2]
    const startDayNum = SPANISH_DAYS[startDayName]
    const endDayNum = SPANISH_DAYS[endDayName]

    if (startDayNum !== undefined && endDayNum !== undefined) {
      const weekDays = eachDayOfInterval({ start: weekContext.startDate, end: weekContext.endDate })
      for (const day of weekDays) {
        const dayOfWeek = getDay(day)
        // Handle wrap-around (e.g., Thu to Sun = 4,5,6,0)
        const inRange =
          startDayNum <= endDayNum
            ? dayOfWeek >= startDayNum && dayOfWeek <= endDayNum
            : dayOfWeek >= startDayNum || dayOfWeek <= endDayNum
        if (inRange) {
          results.push({ date: day, startTime, endTime })
        }
      }
      return results
    }
  }

  // Pattern 5: Month name only (e.g., "Diciembre")
  for (const [monthName, monthNum] of Object.entries(SPANISH_MONTHS)) {
    if (lowerText === monthName || lowerText.includes(monthName)) {
      // If current month matches, return today; otherwise skip
      if (monthNum === getMonth(referenceDate)) {
        results.push({ date: referenceDate, startTime, endTime })
      }
      return results
    }
  }

  // Fallback: Use reference date if we couldn't parse anything
  if (results.length === 0) {
    console.warn(`[BA Tourism] Could not parse date: "${text}"`)
    results.push({ date: referenceDate, startTime, endTime })
  }

  return results
}

/**
 * Convert ParsedDateTime to ISO datetime string
 * All BA Tourism dates are in Argentina timezone - we convert to UTC
 */
export function toISODateTime(parsed: ParsedDateTime): string {
  let date = parsed.date

  if (parsed.startTime) {
    const [hours, minutes] = parsed.startTime.split(':').map(Number)
    date = setHours(setMinutes(date, minutes), hours)
  }

  // Explicitly convert BA time to UTC
  return fromZonedTime(date, BA_TIMEZONE).toISOString()
}

/**
 * Get end time as ISO string if available
 * All BA Tourism dates are in Argentina timezone - we convert to UTC
 */
export function getEndTimeISO(parsed: ParsedDateTime): string | null {
  if (!parsed.endTime) return null

  let date = parsed.date
  const [hours, minutes] = parsed.endTime.split(':').map(Number)
  date = setHours(setMinutes(date, minutes), hours)

  // Explicitly convert BA time to UTC
  return fromZonedTime(date, BA_TIMEZONE).toISOString()
}

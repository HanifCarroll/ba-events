/**
 * Meetup Date Parser
 *
 * Handles Meetup's date formats and recurring event expansion:
 * - "Mon, Jan 5, 2026 · 7:00 PM ART"
 * - "Every Wed • Jan 7, 2026 · 8:30 PM BRT"
 * - ISO 8601 from GraphQL responses
 */

import { parse, parseISO, isValid, addWeeks, format } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import type { ParsedMeetupDateTime } from './types'

const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires'

/**
 * Day name to day of week mapping (0 = Sunday, 6 = Saturday)
 */
const DAY_NAME_TO_NUMBER: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
}

/**
 * Parse Meetup date string to ISO 8601 UTC
 * Handles both human-readable and ISO formats
 */
export function parseMeetupDate(dateStr: string): string {
  // Already ISO format (from GraphQL or DOM datetime attribute)
  // Check for timezone offset pattern: Z, +HH:MM, or -HH:MM at the end
  if (dateStr.includes('T') && /([Zz]|[+-]\d{2}:\d{2})$/.test(dateStr)) {
    const isoDate = parseISO(dateStr)
    if (isValid(isoDate)) {
      return isoDate.toISOString()
    }
  }

  // Try parsing ISO without timezone
  const isoDate = parseISO(dateStr)
  if (isValid(isoDate)) {
    // Assume Argentina timezone
    const utcDate = fromZonedTime(isoDate, ARGENTINA_TZ)
    return utcDate.toISOString()
  }

  // Parse human-readable format: "Mon, Jan 5, 2026 · 7:00 PM ART"
  const cleanedStr = dateStr
    .replace(/·/g, ' ')
    .replace(/•/g, ' ')
    .replace(/Every \w+ /i, '') // Remove "Every Wed "
    .replace(/ART|BRT/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const formats = [
    'EEE, MMM d, yyyy h:mm a',
    'EEE, MMMM d, yyyy h:mm a',
    'MMM d, yyyy h:mm a',
    'MMMM d, yyyy h:mm a',
    'EEE, MMM d, yyyy',
    'MMM d, yyyy',
  ]

  for (const fmt of formats) {
    try {
      const parsed = parse(cleanedStr, fmt, new Date())
      if (isValid(parsed)) {
        // Convert from Argentina time to UTC
        const utcDate = fromZonedTime(parsed, ARGENTINA_TZ)
        return utcDate.toISOString()
      }
    } catch {
      // Try next format
    }
  }

  console.warn(`[Meetup] Could not parse date: "${dateStr}"`)
  return new Date().toISOString()
}

/**
 * Extract recurrence pattern from date string
 * Returns the pattern if found (e.g., "Every Wed"), null otherwise
 */
export function extractRecurrencePattern(dateStr: string): string | null {
  const match = dateStr.match(/Every (\w+)/i)
  return match ? `Every ${match[1]}` : null
}

/**
 * Check if date string indicates a recurring event
 */
export function isRecurringEvent(dateStr: string): boolean {
  return /Every \w+/i.test(dateStr)
}

/**
 * Get the day of week from recurrence pattern
 * "Every Wed" -> 3 (Wednesday)
 */
export function getDayFromPattern(pattern: string): number | null {
  const match = pattern.match(/Every (\w+)/i)
  if (!match) return null

  const dayName = match[1].toLowerCase()
  return DAY_NAME_TO_NUMBER[dayName] ?? null
}

/**
 * Parse time from Meetup format
 * "7:00 PM" -> "19:00"
 * "8:30 PM" -> "20:30"
 */
export function parseTime(timeStr: string): string | null {
  // Try parsing "h:mm a" format
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!match) return null

  let hours = parseInt(match[1], 10)
  const minutes = match[2]
  const period = match[3].toUpperCase()

  if (period === 'PM' && hours !== 12) {
    hours += 12
  } else if (period === 'AM' && hours === 12) {
    hours = 0
  }

  return `${hours.toString().padStart(2, '0')}:${minutes}`
}

/**
 * Expand a recurring event into multiple occurrences
 * Generates events for the next 4 weeks
 */
export function expandRecurringEvent(
  baseDate: Date,
  recurrencePattern: string,
  weeksAhead: number = 4
): Date[] {
  const targetDay = getDayFromPattern(recurrencePattern)
  if (targetDay === null) {
    // Can't determine day, just return the base date
    return [baseDate]
  }

  const dates: Date[] = []
  const currentDate = new Date(baseDate)

  // Start from the base date and generate weeksAhead occurrences
  for (let week = 0; week < weeksAhead; week++) {
    const weekDate = addWeeks(currentDate, week)
    // Adjust to match the target day of week if needed
    // (The base date should already be on the correct day)
    dates.push(new Date(weekDate))
  }

  return dates
}

/**
 * Generate expanded dates with IDs for recurring events
 * Returns array of { date, id } for each occurrence
 */
export function expandRecurringEventWithIds(
  baseId: string,
  baseDateStr: string,
  recurrencePattern: string,
  weeksAhead: number = 4
): Array<{ date: string; id: string }> {
  const baseDate = parseISO(baseDateStr)
  if (!isValid(baseDate)) {
    return [{ date: baseDateStr, id: baseId }]
  }

  const dates = expandRecurringEvent(baseDate, recurrencePattern, weeksAhead)

  return dates.map((date, index) => ({
    date: date.toISOString(),
    id: index === 0 ? baseId : `${baseId}-${format(date, 'yyyy-MM-dd')}`,
  }))
}

/**
 * Parse full Meetup datetime string and extract components
 */
export function parseMeetupDateTime(dateStr: string): ParsedMeetupDateTime {
  // Extract time from string like "7:00 PM"
  const timeMatch = dateStr.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i)
  const startTime = timeMatch ? parseTime(timeMatch[1]) : null

  // Parse the full date
  const dateISO = parseMeetupDate(dateStr)
  const date = parseISO(dateISO)

  return {
    date: isValid(date) ? date : new Date(),
    startTime,
    endTime: null, // Meetup typically doesn't show end time on list page
  }
}

/**
 * Format date for display in Argentina timezone
 */
export function formatArgentinaDate(isoDate: string, formatStr: string = 'EEE, MMM d, yyyy h:mm a'): string {
  const date = parseISO(isoDate)
  if (!isValid(date)) return isoDate

  const argentinaDate = toZonedTime(date, ARGENTINA_TZ)
  return format(argentinaDate, formatStr)
}

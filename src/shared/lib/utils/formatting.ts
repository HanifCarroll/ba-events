import { toZonedTime } from 'date-fns-tz'
import { getLocale } from '@/paraglide/runtime'
import { BA_TIMEZONE } from '@/shared/lib/constants'

/**
 * All date/time formatters render in Buenos Aires time.
 *
 * The app is Buenos Aires events, so times must be BA wall-clock regardless of
 * the viewer's timezone. Pinning the timezone in the Intl options also fixes
 * SSR hydration: the server (UTC) and the client (any local tz) render the
 * same string, so there is no text mismatch. The chat tools already do this
 * via `toZonedTime(..., BA_TIMEZONE)`; these formatters now agree with them.
 */

/**
 * Format a date in the user's locale
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString(getLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: BA_TIMEZONE,
  })
}

/**
 * Format a date with time in the user's locale
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString(getLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: BA_TIMEZONE,
  })
}

/**
 * Format time only in the user's locale
 */
export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString(getLocale(), {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: BA_TIMEZONE,
  })
}

/**
 * Format a short date (no year) in the user's locale
 */
export function formatShortDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString(getLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: BA_TIMEZONE,
  })
}

/**
 * Format a relative date (today, tomorrow, this week, etc.)
 */
export function formatRelativeDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  // Day boundaries are computed in BA time so server and client agree.
  const now = toZonedTime(new Date(), BA_TIMEZONE)
  const target = toZonedTime(d, BA_TIMEZONE)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const targetDate = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const diffDays = Math.floor((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  const locale = getLocale()

  if (diffDays === 0) {
    return locale === 'es' ? 'Hoy' : 'Today'
  } else if (diffDays === 1) {
    return locale === 'es' ? 'Mañana' : 'Tomorrow'
  } else if (diffDays === -1) {
    return locale === 'es' ? 'Ayer' : 'Yesterday'
  } else if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString(locale, { weekday: 'long', timeZone: BA_TIMEZONE })
  }

  return formatShortDate(d)
}

/**
 * Format a number in the user's locale
 */
export function formatNumber(num: number): string {
  return num.toLocaleString(getLocale())
}

/**
 * Format a currency amount in ARS
 */
export function formatCurrency(amount: number): string {
  return amount.toLocaleString(getLocale(), {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  })
}

/**
 * Format event time range in the user's locale
 */
export function formatEventTime(startsAt: string, endsAt: string | null): string {
  const locale = getLocale()
  const start = new Date(startsAt)
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: BA_TIMEZONE,
  }

  let result = start.toLocaleDateString(locale, options)

  if (endsAt) {
    const end = new Date(endsAt)
    const endTime = end.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: BA_TIMEZONE,
    })
    result += ` - ${endTime}`
  }

  return result
}

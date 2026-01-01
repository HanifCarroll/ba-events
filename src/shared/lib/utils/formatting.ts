import { getLocale } from '@/paraglide/runtime'

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
  })
}

/**
 * Format a relative date (today, tomorrow, this week, etc.)
 */
export function formatRelativeDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.floor((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  const locale = getLocale()

  if (diffDays === 0) {
    return locale === 'es' ? 'Hoy' : 'Today'
  } else if (diffDays === 1) {
    return locale === 'es' ? 'Mañana' : 'Tomorrow'
  } else if (diffDays === -1) {
    return locale === 'es' ? 'Ayer' : 'Yesterday'
  } else if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString(locale, { weekday: 'long' })
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
  }

  let result = start.toLocaleDateString(locale, options)

  if (endsAt) {
    const end = new Date(endsAt)
    const endTime = end.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    result += ` - ${endTime}`
  }

  return result
}

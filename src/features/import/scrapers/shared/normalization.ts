/**
 * Shared Normalization Utilities for Event Transformers
 *
 * These utilities provide consistent data normalization across all event source
 * transformers (Passline, Eventbrite, BA Tourism, Meetup).
 */

/**
 * Normalize a title/name by trimming whitespace and normalizing internal whitespace
 *
 * @param title - The title to normalize
 * @returns Normalized title with trimmed and normalized whitespace
 */
export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ')
}

/**
 * Normalize a description by stripping HTML tags and normalizing whitespace
 *
 * @param desc - The description to normalize, may be null
 * @returns Normalized description or null
 */
export function normalizeDescription(desc: string | null): string | null {
  if (!desc) return null

  // Strip HTML tags
  const withoutHtml = desc.replace(/<[^>]*>/g, ' ')

  // Decode common HTML entities
  const decoded = withoutHtml
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))

  // Normalize whitespace: collapse multiple spaces/newlines to single space, trim
  const normalized = decoded.replace(/\s+/g, ' ').trim()

  // Return null if result is empty
  return normalized.length > 0 ? normalized : null
}

/**
 * Normalize a URL by validating and cleaning it
 *
 * @param url - The URL to normalize, may be null
 * @returns Normalized URL or null if invalid
 */
export function normalizeUrl(url: string | null): string | null {
  if (!url) return null

  const trimmed = url.trim()
  if (trimmed.length === 0) return null

  try {
    // Attempt to parse the URL to validate it
    const parsed = new URL(trimmed)

    // Only allow http/https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }

    // Return the normalized URL (URL constructor normalizes it)
    return parsed.href
  } catch {
    // If URL parsing fails, try adding https:// prefix
    try {
      const withProtocol = new URL(`https://${trimmed}`)
      return withProtocol.href
    } catch {
      return null
    }
  }
}

/**
 * Normalize a price value from various input formats.
 *
 * All prices in this application are standardized to ARS pesos:
 * - Passline: Already in pesos, passed through as-is
 * - Luma: Converted from cents to pesos in transformer (price / 100)
 * - Meetup: Already in pesos from API
 * - CSV: User input expected in pesos
 * - Eventbrite/BA Tourism: null (no price data from these sources)
 *
 * @param price - The price to normalize (number, string, or null)
 * @returns Normalized price in ARS pesos rounded to 2 decimal places, or null
 */
export function normalizePrice(price: number | string | null): number | null {
  if (price === null || price === undefined) return null

  // Handle string input
  if (typeof price === 'string') {
    // Remove currency symbols and whitespace
    const cleaned = price.replace(/[^\d.,\-]/g, '').trim()

    if (cleaned.length === 0) return null

    // Handle comma as decimal separator (European format)
    // If there's both comma and period, use the last one as decimal
    let normalizedString = cleaned
    const lastComma = cleaned.lastIndexOf(',')
    const lastPeriod = cleaned.lastIndexOf('.')

    if (lastComma > lastPeriod) {
      // Comma is the decimal separator (e.g., "1.234,56")
      normalizedString = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      // Period is the decimal separator (e.g., "1,234.56")
      normalizedString = cleaned.replace(/,/g, '')
    }

    const parsed = parseFloat(normalizedString)
    if (isNaN(parsed)) return null

    return Math.round(parsed * 100) / 100
  }

  // Handle number input
  if (typeof price === 'number') {
    if (isNaN(price)) return null
    return Math.round(price * 100) / 100
  }

  return null
}

/**
 * Result of normalizing a date range
 */
export interface NormalizedDateRange {
  startDate: Date
  endDate: Date | null
}

/**
 * Normalize a date range from ISO strings
 *
 * @param start - The start date as ISO string
 * @param end - The optional end date as ISO string
 * @returns Normalized date range with Date objects
 */
export function normalizeDateRange(
  start: string,
  end?: string | null
): NormalizedDateRange {
  const startDate = new Date(start)

  // Validate start date
  if (isNaN(startDate.getTime())) {
    throw new Error(`Invalid start date: ${start}`)
  }

  // Parse end date if provided
  let endDate: Date | null = null
  if (end) {
    endDate = new Date(end)
    // Invalid end date becomes null
    if (isNaN(endDate.getTime())) {
      endDate = null
    } else if (endDate < startDate) {
      // End date before start date - set end to null
      endDate = null
    }
  }

  return { startDate, endDate }
}

/**
 * Generate a normalized external ID from a name and date
 * Useful for sources that don't provide unique IDs
 *
 * @param prefix - The source prefix (e.g., 'ba-tourism', 'meetup')
 * @param name - The event name
 * @param date - The event date
 * @returns A normalized external ID
 */
export function generateExternalId(
  prefix: string,
  name: string,
  date: Date
): string {
  const normalizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50)

  const dateStr = date.toISOString().split('T')[0]

  return `${prefix}-${normalizedName}-${dateStr}`
}

/**
 * Normalize an image URL, handling relative URLs and validation
 *
 * @param imageUrl - The image URL to normalize
 * @param baseUrl - Optional base URL for resolving relative URLs
 * @returns Normalized image URL or null
 */
export function normalizeImageUrl(
  imageUrl: string | null,
  baseUrl?: string
): string | null {
  if (!imageUrl) return null

  const trimmed = imageUrl.trim()
  if (trimmed.length === 0) return null

  // If it's a data URL, return as-is
  if (trimmed.startsWith('data:')) {
    return trimmed
  }

  // Try to parse as absolute URL first
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href
    }
    return null
  } catch {
    // If parsing fails and we have a base URL, try resolving as relative
    if (baseUrl) {
      try {
        const resolved = new URL(trimmed, baseUrl)
        if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
          return resolved.href
        }
      } catch {
        return null
      }
    }
    return null
  }
}

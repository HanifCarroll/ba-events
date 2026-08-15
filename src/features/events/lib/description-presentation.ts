import type { Locale } from '#shared/lib/types.ts'

const NOISY_PREFIX_PATTERNS = [
  /^semantic\s+description\s+for\s+indexing:\s*/i,
  /^semantic\s+description:\s*/i,
  /^description\s+for\s+indexing:\s*/i,
  /^descripci[oó]n\s+sem[aá]ntica\s+para\s+indexaci[oó]n:\s*/i,
  /^descripci[oó]n\s+sem[aá]ntica:\s*/i,
]

const BOILERPLATE_LINE_PATTERNS = [
  /^(?:contact|contacto|reservas?|reservation|tickets?|entradas?)[:\s]/i,
  /^(?:whatsapp|instagram|facebook|tiktok|email|mail)[:\s]/i,
]

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function stripHtmlPreservingBreaks(value: string): string {
  return value
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|li|h[1-6])>/gi, '\n\n')
    .replace(/<(?:p|div|section|article|ul|ol|h[1-6])[^>]*>/gi, '')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, ' ')
}

function cleanPrefix(value: string): string {
  let cleaned = value.trim()
  for (const pattern of NOISY_PREFIX_PATTERNS) {
    cleaned = cleaned.replace(pattern, '')
  }
  return cleaned.trim()
}

function normalizeParagraph(paragraph: string): string {
  return paragraph
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim()
}

function isBoilerplateParagraph(paragraph: string): boolean {
  if (!paragraph) return true
  const compact = paragraph.replace(/\s+/g, ' ').trim()
  if (compact.length < 8) return true
  if (BOILERPLATE_LINE_PATTERNS.some((pattern) => pattern.test(compact))) {
    return true
  }
  return false
}

/**
 * Build paragraph-preserving plain text for UI display.
 */
export function buildDisplayDescription(raw: string | null | undefined): string | null {
  if (!raw) return null

  const stripped = stripHtmlPreservingBreaks(raw.replace(/\r/g, ''))
  const decoded = decodeHtmlEntities(stripped)
  const withoutPrefix = cleanPrefix(decoded)

  if (!withoutPrefix) return null

  const split = withoutPrefix
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split(/\n\s*\n/g)
    .map(normalizeParagraph)
    .filter((paragraph) => !isBoilerplateParagraph(paragraph))

  if (split.length === 0) return null

  return split.join('\n\n')
}

function truncateSummary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const truncated = text.slice(0, maxLength - 1)
  const safe = truncated.replace(/\s+\S*$/, '').trim()
  return `${safe || truncated}…`
}

/**
 * Non-persisted summary fallback for rendering when AI summary is not ready.
 */
export function buildFallbackSummary(raw: string | null | undefined, maxLength: number = 200): string | null {
  const display = buildDisplayDescription(raw)
  if (!display) return null

  const firstParagraph = display.split(/\n\n/)[0]?.trim()
  if (!firstParagraph) return null

  const firstSentence = firstParagraph.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? firstParagraph
  return truncateSummary(firstSentence, maxLength)
}

interface DescriptionFieldSource {
  description_summary_en?: string | null
  description_summary_es?: string | null
  description_display_en?: string | null
  description_display_es?: string | null
  description_en?: string | null
  description_es?: string | null
}

/**
 * Locale-aware summary fallback chain for card surfaces.
 */
export function pickDescriptionSummary(event: DescriptionFieldSource, locale: Locale): string | null {
  if (locale === 'es') {
    return (
      event.description_summary_es ??
      event.description_summary_en ??
      buildFallbackSummary(event.description_display_es) ??
      buildFallbackSummary(event.description_display_en) ??
      buildFallbackSummary(event.description_es) ??
      buildFallbackSummary(event.description_en) ??
      null
    )
  }

  return (
    event.description_summary_en ??
    event.description_summary_es ??
    buildFallbackSummary(event.description_display_en) ??
    buildFallbackSummary(event.description_display_es) ??
    buildFallbackSummary(event.description_en) ??
    buildFallbackSummary(event.description_es) ??
    null
  )
}

/**
 * Locale-aware full description fallback chain for detail surfaces.
 */
export function pickDisplayDescription(event: DescriptionFieldSource, locale: Locale): string | null {
  if (locale === 'es') {
    return (
      event.description_display_es ??
      event.description_display_en ??
      buildDisplayDescription(event.description_es) ??
      buildDisplayDescription(event.description_en) ??
      null
    )
  }

  return (
    event.description_display_en ??
    event.description_display_es ??
    buildDisplayDescription(event.description_en) ??
    buildDisplayDescription(event.description_es) ??
    null
  )
}

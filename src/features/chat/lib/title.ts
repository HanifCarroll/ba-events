const DEFAULT_CONVERSATION_TITLE = 'New conversation'
const MAX_TITLE_LENGTH = 60

function stripSurroundingQuotes(text: string): string {
  return text.replace(/^["']+|["']+$/g, '')
}

function truncateTitle(text: string): string {
  if (text.length <= MAX_TITLE_LENGTH) return text
  return text.slice(0, MAX_TITLE_LENGTH - 3) + '...'
}

export function isGenericConversationTitle(title: string | null | undefined): boolean {
  return (title ?? '').trim().toLowerCase() === DEFAULT_CONVERSATION_TITLE.toLowerCase()
}

export function normalizeConversationTitle(input: string): string {
  return truncateTitle(stripSurroundingQuotes(input.trim()).replace(/\s+/g, ' ').trim())
}

export function getFallbackConversationTitle(firstMessage: string): string {
  const normalized = normalizeConversationTitle(firstMessage)
  if (!normalized) return DEFAULT_CONVERSATION_TITLE
  return normalized
}

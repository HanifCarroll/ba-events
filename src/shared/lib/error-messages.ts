/**
 * Contextual Error Messages
 *
 * Provides actionable error messages based on error type and context.
 * Used by mutation hooks to give users helpful feedback.
 */

export interface ErrorContext {
  /** The operation being performed (e.g., "create", "update", "fetch") */
  operation: string
  /** The entity being operated on (e.g., "event", "venue") */
  entity?: string
  /** Additional details or suggestions */
  details?: string
}

/**
 * Get a user-friendly error message based on the error and context
 *
 * @param error - The error object or string
 * @param context - Context about what operation was being performed
 * @returns A user-friendly error message with actionable guidance
 */
export function getErrorMessage(error: unknown, context: ErrorContext): string {
  const baseMessage = error instanceof Error ? error.message : String(error)
  const lowerMessage = baseMessage.toLowerCase()

  // Network/connection errors
  if (
    lowerMessage.includes('fetch') ||
    lowerMessage.includes('network') ||
    lowerMessage.includes('failed to fetch') ||
    lowerMessage.includes('connection')
  ) {
    return `Network error while ${context.operation}${context.entity ? ` ${context.entity}` : ''}. Check your connection and try again.`
  }

  // Authentication/authorization errors
  if (
    lowerMessage.includes('unauthorized') ||
    lowerMessage.includes('403') ||
    lowerMessage.includes('401') ||
    lowerMessage.includes('permission') ||
    lowerMessage.includes('access denied')
  ) {
    return 'Permission denied. You may need to log in again.'
  }

  // Rate limiting
  if (
    lowerMessage.includes('rate') ||
    lowerMessage.includes('429') ||
    lowerMessage.includes('too many requests')
  ) {
    return 'Too many requests. Please wait a moment and try again.'
  }

  // Validation errors - pass through the message
  if (
    lowerMessage.includes('validation') ||
    lowerMessage.includes('invalid') ||
    lowerMessage.includes('required')
  ) {
    return `Invalid data: ${baseMessage}`
  }

  // Database constraint errors
  if (
    lowerMessage.includes('duplicate') ||
    lowerMessage.includes('unique constraint') ||
    lowerMessage.includes('already exists')
  ) {
    return `This ${context.entity || 'record'} already exists. Please use a different name or identifier.`
  }

  // Not found errors
  if (lowerMessage.includes('not found') || lowerMessage.includes('404')) {
    return `The ${context.entity || 'record'} was not found. It may have been deleted.`
  }

  // Timeout errors
  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return `The operation timed out. Please try again or try with fewer items.`
  }

  // Server errors
  if (lowerMessage.includes('500') || lowerMessage.includes('internal server')) {
    return `Server error while ${context.operation}${context.entity ? ` ${context.entity}` : ''}. Please try again later.`
  }

  // Default with context
  const entityStr = context.entity ? ` ${context.entity}` : ''
  const detailsStr = context.details ? ` ${context.details}` : ' Please try again.'
  return `Failed to ${context.operation}${entityStr}.${detailsStr}`
}

/**
 * Get an error message for import-related errors
 */
export function getImportErrorMessage(error: unknown, source: string): string {
  return getErrorMessage(error, {
    operation: 'fetch',
    entity: `${source} events`,
    details: 'Check the source URL and date range.',
  })
}

/**
 * Get an error message for enrichment-related errors
 */
export function getEnrichmentErrorMessage(error: unknown, type: 'event' | 'venue'): string {
  return getErrorMessage(error, {
    operation: 'enrich',
    entity: type,
    details: 'The AI service may be temporarily unavailable.',
  })
}

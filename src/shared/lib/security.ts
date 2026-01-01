/**
 * Security Utilities
 *
 * Functions for sanitizing sensitive data from logs and error messages.
 */

/**
 * Patterns that match sensitive tokens/credentials in URLs and strings
 */
const SENSITIVE_PATTERNS = [
  // API tokens in URLs (e.g., token=xxx, api_key=xxx)
  /([?&](?:token|api_key|apikey|key|secret|password|auth|bearer|access_token|refresh_token)=)[^&\s]+/gi,
  // Browserless.io WebSocket URLs with tokens
  /wss?:\/\/[^?]+\?token=[^&\s]+/gi,
  // Generic token patterns (32+ character hex/base64 strings)
  /\b[a-zA-Z0-9_-]{32,}\b/g,
  // URLs with auth credentials (user:pass@host)
  /:\/\/[^:]+:[^@]+@/g,
]

/**
 * Replacement placeholders for sanitized content
 */
const SANITIZE_REPLACEMENTS = {
  token: '$1[REDACTED]',
  wsUrl: 'wss://[BROWSERLESS_URL_REDACTED]',
  longToken: '[TOKEN_REDACTED]',
  urlAuth: '://[AUTH_REDACTED]@',
}

/**
 * Sanitize sensitive data from error messages and strings
 *
 * Removes or redacts:
 * - API tokens and keys from URLs
 * - Browserless WebSocket URLs with tokens
 * - Long tokens that look like credentials
 * - URL authentication credentials
 *
 * @param input - The string or Error to sanitize
 * @returns Sanitized string safe for logging
 */
export function sanitizeError(input: unknown): string {
  // Handle different input types
  let message: string

  if (input instanceof Error) {
    message = input.message
    // Also check the stack trace for sensitive data
    if (input.stack) {
      // Sanitize both message and stack trace
      return `${sanitizeString(message)}\n${sanitizeString(input.stack)}`
    }
  } else if (typeof input === 'string') {
    message = input
  } else if (input && typeof input === 'object') {
    try {
      message = JSON.stringify(input)
    } catch {
      message = String(input)
    }
  } else {
    message = String(input)
  }

  return sanitizeString(message)
}

/**
 * Internal function to sanitize a string
 */
function sanitizeString(str: string): string {
  let result = str

  // Replace WebSocket URLs with tokens first (most specific)
  result = result.replace(SENSITIVE_PATTERNS[1], SANITIZE_REPLACEMENTS.wsUrl)

  // Replace query parameter tokens
  result = result.replace(SENSITIVE_PATTERNS[0], SANITIZE_REPLACEMENTS.token)

  // Replace URL auth credentials
  result = result.replace(SENSITIVE_PATTERNS[3], SANITIZE_REPLACEMENTS.urlAuth)

  // Replace remaining long token-like strings (be careful not to replace too much)
  // Only apply this to strings that look like they contain tokens after URLs
  result = result.replace(
    /(?:token|key|secret|password|auth)[:=]\s*['"]?([a-zA-Z0-9_-]{32,})['"]?/gi,
    (match, token) => match.replace(token, '[REDACTED]')
  )

  return result
}

/**
 * Create a safe error message for logging
 * Extracts only the message without potentially sensitive stack traces
 *
 * @param error - The error to process
 * @returns A sanitized error message string
 */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeError(error.message)
  }
  if (typeof error === 'string') {
    return sanitizeError(error)
  }
  return 'Unknown error'
}

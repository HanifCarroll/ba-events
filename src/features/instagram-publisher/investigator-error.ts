import { z } from 'zod'

/** Use only for messages safe to include in a model session. */
export class InvestigatorToolError extends Error {}

export function investigatorErrorMessage(error: unknown) {
  if (error instanceof InvestigatorToolError) return error.message
  if (error instanceof z.ZodError) return error.issues.map(issue => {
    const field = issue.path.join('.')
    // Zod would echo the caller's unknown keys. Only describe the schema here.
    const message = issue.code === 'unrecognized_keys' ? 'Remove unexpected fields.' : issue.message
    return field ? `${field}: ${message}` : message
  }).join('; ')
  return 'The operation could not complete.'
}

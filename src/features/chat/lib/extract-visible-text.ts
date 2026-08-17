/**
 * Extracts user-visible assistant text from multi-part responses.
 *
 * The AI SDK can provide multi-step parts during tool loops. For chat UX we only
 * display the final step text and hide intermediate draft/search narration.
 */

import type { UIMessage } from 'ai'

type TextPartLike = {
  type?: string
  text?: string
}

function shouldInsertSpace(left: string, right: string): boolean {
  if (!left || !right) return false
  if (/\s$/.test(left) || /^\s/.test(right)) return false
  if (/[([{"'`-]$/.test(left)) return false
  if (/^[)\]}.,!?;:]/.test(right)) return false
  if (/[.,!?;:)]$/.test(left)) return true
  if (/[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right)) return true
  return false
}

function normalizeBoundaries(text: string): string {
  return text
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/([(\[{])\s+/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
}

function appendTextSegment(base: string, segment: string): string {
  if (!segment) return base
  if (!base) return segment
  return shouldInsertSpace(base, segment) ? `${base} ${segment}` : `${base}${segment}`
}

/**
 * Choose the final non-empty step text and normalize boundaries.
 */
export function extractVisibleTextFromStepTexts(stepTexts: string[]): string {
  for (let i = stepTexts.length - 1; i >= 0; i--) {
    const text = (stepTexts[i] ?? '').trim()
    if (text.length > 0) {
      return normalizeBoundaries(text)
    }
  }
  return ''
}

/**
 * Extract visible assistant text from UI message parts.
 * - Splits text by step boundaries (`step-start`)
 * - Returns only the last non-empty step text
 */
export function extractVisibleTextFromUIMessageParts(parts: TextPartLike[] | undefined): string {
  if (!parts || parts.length === 0) return ''

  const stepTexts: string[] = []
  let currentStepText = ''

  for (const part of parts) {
    if (part.type === 'step-start') {
      stepTexts.push(currentStepText)
      currentStepText = ''
      continue
    }

    if (part.type === 'text' && typeof part.text === 'string') {
      currentStepText = appendTextSegment(currentStepText, part.text)
    }
  }

  stepTexts.push(currentStepText)
  return extractVisibleTextFromStepTexts(stepTexts)
}

/**
 * Return the most recent non-empty user message text from a UI message list.
 */
export function getLastUserQuery(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as {
      role?: string
      parts?: Array<{ type?: string; text?: string }>
      content?: string
    }
    if (message.role !== 'user') continue
    if (Array.isArray(message.parts)) {
      const content = extractVisibleTextFromUIMessageParts(message.parts)
      if (content.trim().length > 0) return content
    }
    if (typeof message.content === 'string' && message.content.trim().length > 0) {
      return message.content
    }
  }
  return ''
}

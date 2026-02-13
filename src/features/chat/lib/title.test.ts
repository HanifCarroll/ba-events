import { describe, expect, it } from 'vitest'
import {
  getFallbackConversationTitle,
  isGenericConversationTitle,
  normalizeConversationTitle,
} from './title'
import { CLAUDE_MODEL } from '@/shared/lib/ai/constants'
import { TITLE_MODEL } from '@/features/chat/api/generate-title'

describe('conversation title utilities', () => {
  it('normalizes quotes and repeated whitespace', () => {
    expect(normalizeConversationTitle('  " Best   sushi   in BA "  ')).toBe('Best sushi in BA')
  })

  it('truncates overlong titles', () => {
    const longTitle = 'a'.repeat(80)
    expect(normalizeConversationTitle(longTitle)).toBe('a'.repeat(57) + '...')
  })

  it('returns deterministic fallback from first user message', () => {
    expect(getFallbackConversationTitle("   'Find jazz in Palermo tonight'  ")).toBe(
      'Find jazz in Palermo tonight'
    )
  })

  it('falls back to generic title for empty text', () => {
    expect(getFallbackConversationTitle('   ')).toBe('New conversation')
  })

  it('matches generic title regardless of case', () => {
    expect(isGenericConversationTitle('new conversation')).toBe(true)
    expect(isGenericConversationTitle('Weekend plan')).toBe(false)
  })

  it('uses shared model constant for title generation', () => {
    expect(TITLE_MODEL).toBe(CLAUDE_MODEL)
  })
})


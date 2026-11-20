import { describe, expect, it } from 'vitest'
import { extractVisibleTextFromUIMessageParts } from './extract-visible-text.ts'

describe('extractVisibleTextFromUIMessageParts', () => {
  it('returns empty string when no text parts exist', () => {
    expect(
      extractVisibleTextFromUIMessageParts([
        { type: 'step-start' },
        { type: 'tool-search_events' },
      ])
    ).toBe('')
  })

  it('uses step boundaries and returns only final step text', () => {
    const result = extractVisibleTextFromUIMessageParts([
      { type: 'text', text: "I'll check first." },
      { type: 'step-start' },
      { type: 'text', text: 'Go to Club 69 tonight.' },
    ])
    expect(result).toBe('Go to Club 69 tonight.')
  })

  it('keeps the last visible answer when the final step contains only whitespace', () => {
    expect(extractVisibleTextFromUIMessageParts([
      { type: 'text', text: 'Dinner in Palermo, then dancing nearby.' },
      { type: 'step-start' },
      { type: 'text', text: '   ' },
    ])).toBe('Dinner in Palermo, then dancing nearby.')
  })

  it('normalizes glued chunk boundaries', () => {
    const result = extractVisibleTextFromUIMessageParts([
      { type: 'text', text: 'combo.' },
      { type: 'text', text: 'Nothing listing in Belgrano.' },
      { type: 'text', text: 'Let me check.' },
      { type: 'text', text: 'Got it.' },
    ])
    expect(result).toBe('combo. Nothing listing in Belgrano. Let me check. Got it.')
  })
})

import { describe, expect, it } from 'vitest'
import {
  extractVisibleTextFromStepTexts,
  extractVisibleTextFromUIMessageParts,
} from './extract-visible-text.ts'

describe('extractVisibleTextFromStepTexts', () => {
  it('returns single-step text unchanged', () => {
    expect(extractVisibleTextFromStepTexts(['Go to Palermo tonight.'])).toBe(
      'Go to Palermo tonight.'
    )
  })

  it('returns the last non-empty step text', () => {
    const result = extractVisibleTextFromStepTexts([
      "I'll check nearby options first.",
      'Go to Noches de Despecho in Palermo.',
    ])
    expect(result).toBe('Go to Noches de Despecho in Palermo.')
  })

  it('falls back to previous step when final step is empty', () => {
    const result = extractVisibleTextFromStepTexts([
      'Dinner in Palermo, then clubbing nearby.',
      '   ',
    ])
    expect(result).toBe('Dinner in Palermo, then clubbing nearby.')
  })
})

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

import { describe, expect, it } from 'vitest'
import { guardCoverageClaims, type CoverageInfo } from './coverage-guard.ts'

// True horizon is well beyond the bounded search window in all these cases.
const coverage: CoverageInfo = {
  searchedTo: '2026-08-17T03:00:00.000Z', // model only searched the next week
  maxEventDate: '2026-09-05T12:00:00.000Z', // furthest scheduled event on record
}

describe('guardCoverageClaims', () => {
  it('appends a correction when the model asserts a false ceiling from a bounded search', () => {
    const text = "That's the furthest one out I've got — a Sunday boat cruise."
    const out = guardCoverageClaims(text, 'en', coverage)
    expect(out).toContain("That's the furthest one out I've got")
    expect(out).toContain('Note: our calendar actually lists events through')
  })

  it('appends for an explicit absence claim ("no events past")', () => {
    const out = guardCoverageClaims(
      "There are no events after this weekend — that's everything published.",
      'en',
      coverage
    )
    expect(out).toContain('actually lists events through')
  })

  it('appends for "only covers" phrasing', () => {
    const out = guardCoverageClaims(
      'My calendar only covers this coming weekend, so I cannot show you further.',
      'en',
      coverage
    )
    expect(out).toContain('actually lists events through')
  })

  it('uses Spanish when locale is es', () => {
    const out = guardCoverageClaims(
      'Es lo más lejos que puedo llegar — solo hay eventos hasta el fin de semana.',
      'es',
      coverage
    )
    expect(out).toContain('nuestro calendario en realidad llega hasta el')
  })

  it('does not fire when the searched window reaches the horizon', () => {
    const full = { searchedTo: coverage.maxEventDate, maxEventDate: coverage.maxEventDate }
    const out = guardCoverageClaims("That's the furthest one out I've got.", 'en', full)
    expect(out).toBe("That's the furthest one out I've got.")
  })

  it('does not fire on a benign weekend recommendation with no ceiling claim', () => {
    const out = guardCoverageClaims(
      'Here are the best options for this weekend in Palermo.',
      'en',
      coverage
    )
    expect(out).toBe('Here are the best options for this weekend in Palermo.')
  })

  it('fails open: no coverage info leaves text unchanged', () => {
    expect(guardCoverageClaims('Some answer.', 'en', null)).toBe('Some answer.')
    expect(guardCoverageClaims('Some answer.', 'en', {})).toBe('Some answer.')
    expect(guardCoverageClaims('', 'en', coverage)).toBe('')
  })
})

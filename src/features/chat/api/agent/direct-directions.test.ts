import { beforeAll, describe, expect, it } from 'vitest'
import { runAgentFixture } from './run-agent-fixture.ts'

const cases = ['complete', 'default', 'continue', 'details-first', 'failed', 'ambiguous']
  .flatMap(mode => ['en', 'es'].map(locale => [mode, locale]))

describe('eval-only complete directions tool', () => {
  let results: ReturnType<typeof runAgentFixture>
  beforeAll(() => {
    results = runAgentFixture(new URL('./direct-directions.fixture.ts', import.meta.url), JSON.stringify(cases))
  }, 20_000)

  for (const [mode, locale] of cases) {
    const key = `${mode}/${locale}`
    it(`preserves source reads and termination for ${key}`, () => {
      const result = results[key]
      expect(result).toBeDefined()
      expect(result.fallback).toBe(false)
      expect(result.calls).toBe(mode === 'complete' ? 1 : ['continue', 'details-first'].includes(mode) ? 3 : 2)
      if (mode === 'ambiguous') { expect(result.kind).toBe('clarification'); expect(result.directionReads).toBe(0) }
      else if (['continue', 'details-first'].includes(mode)) { expect(result.detailReads).toBe(1); expect(result.text).toBe('The source describes live jazz.') }
      else {
        expect(result.eventId).toBe('11111111-1111-4111-8111-111111111111')
        expect(result.directionReads).toBe(mode === 'failed' ? 2 : 1)
        if (mode !== 'default') expect(result.text).toBe(locale === 'es' ? 'Abrí el mapa para ver cómo llegar.' : 'Open the map for directions.')
      }
    })
  }
})

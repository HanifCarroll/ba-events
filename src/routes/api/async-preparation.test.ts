import { describe, expect, it } from 'vitest'
import { runJsonFixture } from '../../../tests/support/run-fixture.ts'

describe('independent request preparation', () => {
  for (const mode of ['events', 'chat']) {
    it(mode === 'chat' ? 'overlaps chat preparation without bypassing the persistence gate' : 'refuses event creation without calling providers', () => {
      const result = runJsonFixture(new URL('./async-preparation.fixture.ts', import.meta.url), [mode],
        { ADMIN_API_KEY: 'fixture', AI_API_KEY: 'fixture', LANGFUSE_TRACING_ENABLED: 'false' }, 5000)
      expect(result).toEqual({ mode, passed: true })
    })
  }
})

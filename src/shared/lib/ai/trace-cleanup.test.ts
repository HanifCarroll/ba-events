import { describe, expect, it } from 'vitest'
import { runJsonFixture } from '../../../../tests/support/run-fixture.ts'

describe('tracing cleanup after owning Effect interruption', () => {
  for (const mode of ['interrupted', 'completed', 'unretained', 'retention-error']) {
    it(`preserves bounded export and one generation for ${mode}`, () => {
      const result = runJsonFixture(new URL('./trace-cleanup.fixture.ts', import.meta.url), [mode],
        { LANGFUSE_PUBLIC_KEY: 'fixture', LANGFUSE_SECRET_KEY: 'fixture', LANGFUSE_BASE_URL: 'http://127.0.0.1', LANGFUSE_TRACING_ENABLED: 'true' }, 4000)
      expect(result).toEqual({
        interrupted: mode === 'interrupted', returnedBeforeFlush: ['interrupted', 'completed'].includes(mode),
        retainedPendingAfterInterruption: ['interrupted', 'completed'].includes(mode), cleanupSettled: true, runs: 1, networkCalls: 0,
      })
    })
  }
})

import { describe, expect, it } from 'vitest'
import { runJsonFixture } from '../../../tests/support/run-fixture.ts'

describe('request preparation and replay', () => {
  it.each([
    ['refuses event creation without calling providers', 'events'],
    ['overlaps chat preparation without bypassing the persistence gate', 'chat'],
    ['checkpoints and publishes the stored answer once despite unreadable client history', 'replay'],
  ])('%s', (_name, mode) => {
    const result = runJsonFixture(new URL('./async-preparation.fixture.ts', import.meta.url), [mode],
      { ADMIN_API_KEY: 'fixture', AI_API_KEY: 'fixture', LANGFUSE_TRACING_ENABLED: 'false' }, 5_000)
    expect(result).toEqual({ mode, passed: true })
  })
})

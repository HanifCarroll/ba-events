import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { runFixture } from '../../../../tests/support/run-fixture.ts'

describe('catalog importers on D1', () => {
  it('imports Luma, Meetup, and BA Tourism into D1 and Vectorize: blocklist, venues, hidden locations, and an unchanged re-run', () => {
    expect(() => runFixture(fileURLToPath(new URL('./importers-d1.fixture.ts', import.meta.url)), [],
      { AI_API_KEY: 'fixture', LANGFUSE_TRACING_ENABLED: 'false' }, 90_000)).not.toThrow()
  }, 90_000)
})

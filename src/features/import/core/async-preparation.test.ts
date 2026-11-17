import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { runFixture } from '../../../../tests/support/run-fixture.ts'

describe('catalog import independent preparation', () => {
  for (const source of ['luma', 'meetup', 'ba-tourism']) {
    it(`overlaps ${source} preparation without changing skip, update or failure handling`, async () => {
      await expect(runFixture(fileURLToPath(new URL('./async-preparation.fixture.ts', import.meta.url)), [source],
        { AI_API_KEY: 'fixture', LANGFUSE_TRACING_ENABLED: 'false' }, 15_000)).resolves.toBeUndefined()
    }, 20_000)
  }
})

import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

describe('catalog import independent preparation', () => {
  for (const source of ['luma', 'eventbrite', 'meetup', 'venti', 'ba-tourism']) {
    it(`overlaps ${source} preparation without changing skip, update or failure handling`, async () => {
      const { stdout } = await promisify(execFile)('bun', [fileURLToPath(new URL('./async-preparation.fixture.ts', import.meta.url)), source], {
        timeout: 5000, env: { PATH: process.env.PATH, AI_API_KEY: 'fixture', LANGFUSE_TRACING_ENABLED: 'false' },
      })
      expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toEqual({ source, passed: true })
    })
  }
})

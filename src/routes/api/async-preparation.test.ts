import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

describe('independent request preparation', () => {
  for (const mode of ['events', 'chat']) {
    it(`overlaps ${mode} preparation without bypassing the persistence gate`, async () => {
      const { stdout } = await promisify(execFile)('bun', [fileURLToPath(new URL('./async-preparation.fixture.ts', import.meta.url)), mode], {
        timeout: 5000, env: { PATH: process.env.PATH, ADMIN_API_KEY: 'fixture', AI_API_KEY: 'fixture', LANGFUSE_TRACING_ENABLED: 'false' },
      })
      expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toEqual({ mode, passed: true })
    })
  }
})

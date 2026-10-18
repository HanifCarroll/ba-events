import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

describe('tracing cleanup after owning Effect interruption', () => {
  for (const mode of ['interrupted', 'completed', 'unretained', 'retention-error']) {
  it(`preserves bounded export and one generation for ${mode}`, async () => {
    const { stdout } = await promisify(execFile)('bun', [fileURLToPath(new URL('./trace-cleanup.fixture.ts', import.meta.url)), mode], {
      timeout: 4000,
      env: { PATH: process.env.PATH, LANGFUSE_PUBLIC_KEY: 'fixture', LANGFUSE_SECRET_KEY: 'fixture', LANGFUSE_BASE_URL: 'http://127.0.0.1', LANGFUSE_TRACING_ENABLED: 'true' },
    })
    expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toEqual({
      interrupted: mode === 'interrupted', returnedBeforeFlush: ['interrupted', 'completed'].includes(mode),
      retainedPendingAfterInterruption: ['interrupted', 'completed'].includes(mode), cleanupSettled: true, runs: 1, networkCalls: 0,
    })
  })
  }
})

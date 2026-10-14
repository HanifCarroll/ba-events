import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)

describe('production model runner cancellation', () => {
  it('stops after observed oversized context and retains successful source reads', async () => {
    const { stdout } = await run('bun', [fileURLToPath(new URL('./model-cancellation.fixture.ts', import.meta.url)), 'context-budget'], {
      timeout: 4000,
      env: { PATH: process.env.PATH, AI_API_KEY: 'test-only-key', DEEPSEEK_API_KEY: 'test-only-key', LANGFUSE_TRACING_ENABLED: 'false' },
    })
    expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toEqual({
      calls: 1, businessReads: 1, eventIds: ['kept-event'], fallbackUsed: true,
    })
  })

  for (const mode of ['generate', 'stream']) {
    it(`aborts the actual SDK ${mode} request without retrying`, async () => {
      // A separate Bun process keeps the real SDK independent of other suites'
      // module mocks. Both supported runners verify the same production leaf.
      const { stdout } = await run('bun', [fileURLToPath(new URL('./model-cancellation.fixture.ts', import.meta.url)), mode], {
        timeout: 4000,
        env: { PATH: process.env.PATH, AI_API_KEY: 'test-only-key', DEEPSEEK_API_KEY: 'test-only-key', LANGFUSE_TRACING_ENABLED: 'false' },
      })
      const result = JSON.parse(stdout.trim().split('\n').at(-1)!)
      expect(result).toEqual({ rejected: true, aborted: true, calls: 1, bodyAborted: mode === 'stream' })
    })
  }
})

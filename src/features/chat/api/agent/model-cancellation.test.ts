import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)

describe('production model runner cancellation', () => {
  it('keeps production thinking enabled and fingerprints the explicitly injected disabled evaluation', async () => {
    const receipts = []
    for (const mode of ['default', 'disabled', 'low']) {
      const { stdout } = await run('bun', [fileURLToPath(new URL('./model-cancellation.fixture.ts', import.meta.url)), 'thinking', mode], {
        timeout: 4000, env: { PATH: process.env.PATH, AI_API_KEY: 'test-only-key', LANGFUSE_TRACING_ENABLED: 'false' },
      })
      receipts.push(JSON.parse(stdout.trim().split('\n').at(-1)!))
    }
    expect(receipts[0]).toMatchObject({ wireThinking: { type: 'enabled' }, maxOutputTokens: 8192, calls: 1,
      configuration: { configuredThinking: 'adaptive', wireThinking: 'enabled', model: 'deepseek-flash' } })
    expect(receipts[1]).toMatchObject({ wireThinking: { type: 'disabled' }, maxOutputTokens: 8192, calls: 1,
      configuration: { configuredThinking: 'disabled', wireThinking: 'disabled', model: 'deepseek-flash' } })
    expect(receipts[0].configuration.id).not.toBe(receipts[1].configuration.id)
    expect(receipts[0].wireEffort).toBeUndefined()
    expect(receipts[2]).toMatchObject({ wireThinking: { type: 'enabled' }, wireEffort: 'low', maxOutputTokens: 8192, calls: 1,
      configuration: { configuredThinking: 'adaptive', wireThinking: 'enabled', reasoningEffort: 'low', model: 'deepseek-flash' } })
    expect(receipts[0].configuration.id).not.toBe(receipts[2].configuration.id)
  })
  it('stops after observed oversized context and retains successful source reads', async () => {
    const { stdout } = await run('bun', [fileURLToPath(new URL('./model-cancellation.fixture.ts', import.meta.url)), 'context-budget'], {
      timeout: 4000,
      env: { PATH: process.env.PATH, AI_API_KEY: 'test-only-key', DEEPSEEK_API_KEY: 'test-only-key', LANGFUSE_TRACING_ENABLED: 'false' },
    })
    expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toEqual({
      calls: 1, maxOutputTokens: 8192, businessReads: 1, eventIds: ['kept-event'], fallbackUsed: true,
    })
  })

  it('retains actual SDK model, cache, output and reasoning usage for the eval adapter', async () => {
    const { stdout } = await run('bun', [fileURLToPath(new URL('./model-cancellation.fixture.ts', import.meta.url)), 'usage'], {
      timeout: 4000,
      env: { PATH: process.env.PATH, AI_API_KEY: 'test-only-key', DEEPSEEK_API_KEY: 'test-only-key', LANGFUSE_TRACING_ENABLED: 'false' },
    })
    expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toEqual([
      { provider: 'deepseek.chat', model: 'deepseek-flash', responseModel: 'deepseek-returned-test', inputTokens: 12, cacheReadTokens: 7, outputTokens: 4, reasoningTokens: 1 },
    ])
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

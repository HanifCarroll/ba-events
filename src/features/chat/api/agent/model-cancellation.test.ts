import { describe, expect, it } from 'vitest'
import { runAgentFixture } from './run-agent-fixture.ts'

const fixture = new URL('./model-cancellation.fixture.ts', import.meta.url)

describe('production model runner cancellation', () => {
  it('keeps production thinking enabled and fingerprints the explicitly injected disabled evaluation', () => {
    const receipts = ['default', 'disabled', 'low'].map(mode => runAgentFixture(fixture, 'thinking', mode))
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
  it('stops after observed oversized context and retains successful source reads', () => {
    expect(runAgentFixture(fixture, 'context-budget')).toEqual({
      calls: 1, maxOutputTokens: 8192, businessReads: 1, eventIds: ['kept-event'], fallbackUsed: true,
    })
  })

  it('retains actual SDK model, cache, output and reasoning usage for the eval adapter', () => {
    expect(runAgentFixture(fixture, 'usage')).toEqual([
      { provider: 'deepseek.chat', model: 'deepseek-flash', responseModel: 'deepseek-returned-test', inputTokens: 12, cacheReadTokens: 7, outputTokens: 4, reasoningTokens: 1 },
    ])
  })

  for (const mode of ['generate', 'stream']) {
    it(`aborts the actual SDK ${mode} request without retrying`, () => {
      expect(runAgentFixture(fixture, mode)).toEqual({ rejected: true, aborted: true, calls: 1, bodyAborted: mode === 'stream' })
    })
  }
})

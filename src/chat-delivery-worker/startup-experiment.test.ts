import { describe, expect, it } from 'vitest'
import { selectedForEarlyStartup } from './startup-experiment.ts'

describe('bounded startup comparison selection', () => {
  const now = 1_000_000, id = 'b787e8b4-1bb3-4bfb-867f-4f45616a99d8'
  const valid = { expiresAt: now + 60_000, attemptIds: [id] }
  it('selects exactly the configured attempt during the campaign', () => {
    expect(selectedForEarlyStartup(JSON.stringify(valid), id, now)).toBe(true)
    expect(selectedForEarlyStartup(JSON.stringify(valid), crypto.randomUUID(), now)).toBe(false)
    expect(selectedForEarlyStartup(JSON.stringify(valid), id, valid.expiresAt)).toBe(false)
  })
  it('fails closed for absent, malformed, oversized, excessive and long-lived configurations', () => {
    for (const config of [undefined, '', '{}', 'after-admission', 'x'.repeat(4097),
      JSON.stringify({ ...valid, attemptIds: [id, '*'] }), JSON.stringify({ ...valid, attemptIds: [1] }),
      JSON.stringify({ ...valid, attemptIds: Array.from({ length: 65 }, () => id) }),
      JSON.stringify({ ...valid, expiresAt: now + 2 * 60 * 60_000 + 1 }), JSON.stringify({ ...valid, expiresAt: null }),
    ]) expect(selectedForEarlyStartup(config, id, now)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import type { CapturedNetworkRequest } from 'posthog-js'
import { redactReplayNetworkRequest } from './replay-network.ts'

describe('replay network URL privacy', () => {
  it('redacts the recorded initial navigation without changing its source or timings', () => {
    const original: CapturedNetworkRequest = {
      name: 'https://baeventos.com/?q=private-search&replay_canary=test#private-fragment',
      entryType: 'navigation', startTime: 0, duration: 1300, isInitial: true,
    }
    expect(redactReplayNetworkRequest(original)).toEqual({ ...original, name: 'https://baeventos.com/' })
    expect(original.name).toContain('private-search')
  })

  it('preserves network diagnostics while excluding URL credentials and arbitrary query fields', () => {
    const original: CapturedNetworkRequest = {
      name: 'https://user:secret@baeventos.com/api/events?new_private_field=value#secret',
      entryType: 'resource', startTime: 12, duration: 30, method: 'GET', status: 503,
    }
    expect(redactReplayNetworkRequest(original)).toEqual({ ...original, name: 'https://baeventos.com/api/events' })
  })

  it('omits invalid and non-network URLs instead of retaining their content', () => {
    for (const name of ['not a URL', 'data:text/plain,private', 'file:///Users/private/report']) {
      expect(redactReplayNetworkRequest({ name, entryType: 'resource', startTime: 0, duration: 1 })).toBeUndefined()
    }
  })
})

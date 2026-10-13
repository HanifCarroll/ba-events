import { describe, expect, it } from 'vitest'
import { isGoogleAnalyticsOutcome } from './analytics.ts'

describe('isGoogleAnalyticsOutcome', () => {
  it('limits GA4 to meaningful product outcomes', () => {
    expect(isGoogleAnalyticsOutcome('chat:response_received')).toBe(true)
    expect(isGoogleAnalyticsOutcome('event:saved')).toBe(true)
    expect(isGoogleAnalyticsOutcome('chat:message_sent')).toBe(false)
    expect(isGoogleAnalyticsOutcome('chat:error')).toBe(false)
    expect(isGoogleAnalyticsOutcome('chat:helpfulness_rated')).toBe(false)
    expect(isGoogleAnalyticsOutcome('chat:feedback_shown')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { resolveMessageTimestamp } from './message-timestamps'

describe('resolveMessageTimestamp', () => {
  it('uses the persisted creation time when present', () => {
    const timestamps = new Map<string, Date>()
    const timestamp = resolveMessageTimestamp(
      { id: 'message-1', metadata: { createdAt: '2026-08-13T12:15:00.000Z' } },
      timestamps
    )

    expect(timestamp.toISOString()).toBe('2026-08-13T12:15:00.000Z')
  })

  it('assigns a live message timestamp only once', () => {
    const timestamps = new Map<string, Date>()
    const first = resolveMessageTimestamp(
      { id: 'message-1' },
      timestamps,
      () => new Date('2026-08-13T12:15:00.000Z')
    )
    const second = resolveMessageTimestamp(
      { id: 'message-1' },
      timestamps,
      () => new Date('2026-08-13T12:20:00.000Z')
    )

    expect(first.toISOString()).toBe('2026-08-13T12:15:00.000Z')
    expect(second).toBe(first)
  })
})

import { describe, expect, it } from 'vitest'
import {
  compareMessagesByTurnOrderAsc,
  pickLatestMessageByTurnOrder,
  sortMessagesByTurnOrderAsc,
} from './message-order.ts'

describe('message turn ordering helpers', () => {
  it('orders user before assistant within the same turn', () => {
    const sorted = sortMessagesByTurnOrderAsc([
      { id: 'assistant-1', role: 'assistant', turn_index: 2 },
      { id: 'user-1', role: 'user', turn_index: 2 },
    ])

    expect(sorted.map((item) => item.id)).toEqual(['user-1', 'assistant-1'])
  })

  it('falls back to sequence number when turn index is missing', () => {
    const comparison = compareMessagesByTurnOrderAsc(
      { id: 'm1', role: 'user', sequence_number: 1 },
      { id: 'm2', role: 'assistant', sequence_number: 2 }
    )

    expect(comparison).toBeLessThan(0)
  })

  it('picks latest message using deterministic turn ordering', () => {
    const latest = pickLatestMessageByTurnOrder([
      { id: 'u1', role: 'user', turn_index: 0 },
      { id: 'a1', role: 'assistant', turn_index: 0 },
      { id: 'u2', role: 'user', turn_index: 1 },
    ])

    expect(latest?.id).toBe('u2')
  })
})

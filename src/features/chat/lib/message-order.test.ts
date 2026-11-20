import { describe, expect, it } from 'vitest'
import { sortMessagesByTurnOrderAsc } from './message-order.ts'

describe('message turn ordering helpers', () => {
  it('keeps each reply between its user message and the next turn', () => {
    const sorted = sortMessagesByTurnOrderAsc([
      { id: 'user-2', role: 'user', turn_index: 3 },
      { id: 'assistant-1', role: 'assistant', turn_index: 2 },
      { id: 'user-1', role: 'user', turn_index: 2 },
    ])

    expect(sorted.map((item) => item.id)).toEqual(['user-1', 'assistant-1', 'user-2'])
  })

  it('renders legacy history in sequence order when turn indexes are missing', () => {
    const sorted = sortMessagesByTurnOrderAsc([
      { id: 'm1', role: 'user', sequence_number: 2 },
      { id: 'm2', role: 'assistant', sequence_number: 1 },
    ])

    expect(sorted.map(item => item.id)).toEqual(['m2', 'm1'])
  })
})

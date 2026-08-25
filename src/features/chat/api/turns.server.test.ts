import { describe, expect, it } from 'vitest'
import { effectiveTurnStatus, type ChatTurn } from './turns.server.ts'

const turn = { status: 'running', claimed_until: '2026-08-25T12:00:00.000Z' } as ChatTurn

describe('chat turn load semantics', () => {
	it('reports expired running turns as interrupted without claiming them', () => {
		expect(effectiveTurnStatus(turn, Date.parse('2026-08-25T12:01:00.000Z'))).toBe('interrupted')
		expect(effectiveTurnStatus(turn, Date.parse('2026-08-25T11:59:00.000Z'))).toBe('running')
	})
})

import { describe, expect, it } from 'vitest'
import {
	findRetryTurn,
	resetAttemptedTurnIds,
	shouldAutoHandlePendingTurn,
	shouldPersistUserMessage
} from './pending-turn-guard.ts'

describe('pending turn guard', () => {
	it('handles a pending turn once and ignores stale props afterward', () => {
		const attempted = new Set<string>()
		const input = { conversationId: 'conversation', pendingTurnId: 'turn', requestPhase: 'idle' as const, chatReady: true, attemptedTurnIds: attempted }
		expect(shouldAutoHandlePendingTurn(input)).toBe(true)
		attempted.add('turn')
		expect(shouldAutoHandlePendingTurn(input)).toBe(false)
	})

	it('clears the guard only when the conversation changes', () => {
		const attempted = new Set(['turn'])
		resetAttemptedTurnIds(attempted, false)
		expect(attempted.has('turn')).toBe(true)
		resetAttemptedTurnIds(attempted, true)
		expect(attempted.size).toBe(0)
	})

	it('hides the stale retry row while its explicit retry is active', () => {
		const turns = [
			{ id: 'turn-1', status: 'interrupted' },
			{ id: 'turn-2', status: 'failed' }
		]
		expect(findRetryTurn(turns, null)?.id).toBe('turn-1')
		expect(findRetryTurn(turns, 'turn-1')?.id).toBe('turn-2')
	})

	it('uses durable bootstrap as the only user persistence for new turns', () => {
		expect(shouldPersistUserMessage(null)).toBe(true)
		expect(shouldPersistUserMessage('turn')).toBe(false)
	})
})

import { describe, expect, it } from 'vitest'
import { ChatState } from './chat.svelte.ts'

// Logic-level port of the legacy `ChatProvider.test.tsx` and
// `ChatProvider.handoff.test.tsx`. The React render hooks are gone — the
// ChatState class exposes the same imperative surface directly.

describe('ChatState first-message handoff', () => {
	it('peek is non-destructive and take is one-shot', () => {
		const state = new ChatState()

		expect(state.peekPendingFirstMessage()).toBeNull()

		const parked = { content: 'hola', eventId: undefined, handoffId: 'h-1' }
		state.setPendingFirstMessage(parked)

		// Peek may be called any number of times (render is not idempotent-safe
		// otherwise) and must not clear the parked message.
		expect(state.peekPendingFirstMessage()).toEqual(parked)
		expect(state.peekPendingFirstMessage()).toEqual(parked)

		// Take clears on read: the second call returns null, so repeated mount
		// effects can never double-send.
		expect(state.takePendingFirstMessage()).toEqual(parked)
		expect(state.takePendingFirstMessage()).toBeNull()
		expect(state.peekPendingFirstMessage()).toBeNull()
	})

	it('a later park overwrites an earlier one', () => {
		const state = new ChatState()

		state.setPendingFirstMessage({ content: 'first', handoffId: 'h-1' })
		state.setPendingFirstMessage({ content: 'second', eventId: 'evt-1', handoffId: 'h-2' })

		expect(state.takePendingFirstMessage()).toEqual({
			content: 'second',
			eventId: 'evt-1',
			handoffId: 'h-2'
		})
	})
})

describe('ChatState conversation scroll memory', () => {
	it('keeps independent scroll positions per conversation', () => {
		const state = new ChatState()

		state.saveConversationScrollPosition('conversation-a', 248)
		state.saveConversationScrollPosition('conversation-b', 64)

		expect(state.getConversationScrollPosition('conversation-a')).toBe(248)
		expect(state.getConversationScrollPosition('conversation-b')).toBe(64)
	})

	it('returns null for a conversation that was never scrolled', () => {
		const state = new ChatState()
		expect(state.getConversationScrollPosition('missing')).toBeNull()
	})
})

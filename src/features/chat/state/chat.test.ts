import { describe, expect, it } from 'vitest'
import { HandoffState } from './handoff-state.ts'

// Logic-level port of the legacy `ChatProvider.test.tsx` and
// `ChatProvider.handoff.test.tsx`. The React render hooks are gone — the
// `ChatState` class (which inherits these exact methods from HandoffState)
// exposes the same imperative surface directly. The pure handoff/scroll state
// lives in handoff-state.ts so it runs in any runner (Bun, Vitest) without the
// Svelte runtime or SvelteKit virtual modules.

describe('ChatState first-message handoff', () => {
	it('peek is non-destructive and take is one-shot', () => {
		const state = new HandoffState()

		expect(state.peekPendingFirstMessage()).toBeNull()

		const parked = {
			content: 'hola',
			conversationId: '00000000-0000-4000-8000-000000000001',
			userClientMessageId: 'user-1',
			assistantClientMessageId: 'assistant-1',
			eventId: undefined,
			handoffId: 'h-1'
		}
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
		const state = new HandoffState()

		state.setPendingFirstMessage({
			content: 'first',
			conversationId: 'conversation-1',
			userClientMessageId: 'user-1',
			assistantClientMessageId: 'assistant-1',
			handoffId: 'h-1'
		})
		state.setPendingFirstMessage({
			content: 'second',
			conversationId: 'conversation-2',
			userClientMessageId: 'user-2',
			assistantClientMessageId: 'assistant-2',
			eventId: 'evt-1',
			happeningSoonEventIds: ['home-1'],
			handoffId: 'h-2'
		})

		expect(state.takePendingFirstMessage()).toEqual({
			content: 'second',
			conversationId: 'conversation-2',
			userClientMessageId: 'user-2',
			assistantClientMessageId: 'assistant-2',
			eventId: 'evt-1',
			happeningSoonEventIds: ['home-1'],
			handoffId: 'h-2'
		})
	})
})

describe('ChatState conversation scroll memory', () => {
	it('keeps independent scroll positions per conversation', () => {
		const state = new HandoffState()

		state.saveConversationScrollPosition('conversation-a', 248)
		state.saveConversationScrollPosition('conversation-b', 64)

		expect(state.getConversationScrollPosition('conversation-a')).toBe(248)
		expect(state.getConversationScrollPosition('conversation-b')).toBe(64)
	})

	it('returns null for a conversation that was never scrolled', () => {
		const state = new HandoffState()
		expect(state.getConversationScrollPosition('missing')).toBeNull()
	})
})

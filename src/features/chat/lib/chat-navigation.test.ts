import { describe, expect, it } from 'vitest'
import { getChatConversationId, getChatHandoffNavigation } from './chat-navigation.ts'

describe('chat handoff navigation', () => {
	it('prefers route params, then shallow state, then the URL', () => {
		expect(getChatConversationId('/chat/from-url', 'from-param', 'from-state')).toBe('from-param')
		expect(getChatConversationId('/', undefined, 'from-state')).toBe('from-state')
		expect(getChatConversationId('/chat/from-url')).toBe('from-url')
		expect(getChatConversationId('/chat', undefined, 'stale-state')).toBeNull()
		expect(getChatConversationId('/')).toBeNull()
	})

	it('carries the conversation ID without dropping page state', () => {
		const state = { selectedEvent: { event: { id: 'event-1' } } } as App.PageState
		expect(getChatHandoffNavigation('conversation/1', state)).toEqual({
		url: '/chat/conversation%2F1',
		state: { ...state, chatConversationId: 'conversation/1' }
	})
	})
})

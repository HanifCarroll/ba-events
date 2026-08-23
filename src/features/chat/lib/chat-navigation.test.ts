import { describe, expect, it } from 'vitest'
import { getChatConversationId, getChatHandoffNavigation } from './chat-navigation.ts'

describe('chat handoff navigation', () => {
	it('uses route params for direct chat links and the URL for shallow handoffs', () => {
		expect(getChatConversationId('/chat/from-url', 'from-param')).toBe('from-param')
		expect(getChatConversationId('/chat/from-url')).toBe('from-url')
		expect(getChatConversationId('/')).toBeNull()
	})

	it('builds a history entry without dropping page state', () => {
		const state = { selectedEvent: { event: { id: 'event-1' } } } as App.PageState
		expect(getChatHandoffNavigation('conversation/1', state)).toEqual({
		url: '/chat/conversation%2F1',
		state
	})
	})
})

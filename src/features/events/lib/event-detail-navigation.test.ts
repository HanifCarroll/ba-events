import { describe, expect, it } from 'vitest'
import {
	getChatEventHref,
	shouldInterceptChatEventClick
} from './event-detail-navigation.ts'

const click = (overrides: Partial<MouseEvent> = {}) => ({
	button: 0,
	metaKey: false,
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
	...overrides
})

describe('event detail shallow navigation', () => {
	it('builds chat-scoped event URLs', () => {
		expect(getChatEventHref('/chat/conversation-1', 'event/1')).toBe(
			'/chat/conversation-1?event=event%2F1'
		)
	})

	it('intercepts ordinary chat clicks for every card variant', () => {
		expect(shouldInterceptChatEventClick('chat', click())).toBe(true)
	})

	it('leaves saved-page and modified clicks native', () => {
		expect(shouldInterceptChatEventClick('saved_page', click())).toBe(false)
		expect(shouldInterceptChatEventClick('chat', click({ metaKey: true }))).toBe(false)
		expect(shouldInterceptChatEventClick('chat', click({ ctrlKey: true }))).toBe(false)
		expect(shouldInterceptChatEventClick('chat', click({ button: 1 }))).toBe(false)
	})
})

import { describe, expect, it } from 'vitest'
import type { EventWithVenue } from '#shared/lib/types.ts'
import { buildEventDetailData } from './event-detail-data.ts'
import {
	getChatEventHref,
	getEventDetailsGotoOptions,
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
	it('builds chat-scoped event URLs without leaving the chat route', () => {
		expect(getChatEventHref('/chat/conversation-1', 'event/1')).toBe(
			'/chat/conversation-1?event=event%2F1'
		)
	})

	it('builds immediate shallow-goto state from the card event', () => {
		const event = {
			id: 'event-1',
			name: 'A show',
			venue_neighborhood: 'Palermo'
		} as EventWithVenue
		const selectedEvent = buildEventDetailData(event)

		expect(getEventDetailsGotoOptions(selectedEvent)).toEqual({
			state: { selectedEvent },
			shallow: true
		})
		expect(selectedEvent.event).toBe(event)
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

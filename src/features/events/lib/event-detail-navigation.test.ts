import { describe, expect, it } from 'vitest'
import type { EventWithVenue } from '#shared/lib/types.ts'
import { buildEventDetailData } from './event-detail-data.ts'
import {
	getChatEventHref,
	getEventDetailsGotoOptions,
	getEventResponseId,
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

	it('preserves route state when building immediate shallow-goto state', () => {
		const event = {
			id: 'event-1',
			name: 'A show',
			venue_neighborhood: 'Palermo'
		} as EventWithVenue
		const selectedEvent = buildEventDetailData(event)
		const state = {} as App.PageState

		expect(getEventDetailsGotoOptions(selectedEvent, state)).toEqual({
			state: { ...state, selectedEvent },
			shallow: true
		})
		expect(selectedEvent.event).toBe(event)
	})

	it('intercepts ordinary chat clicks for every card variant', () => {
		expect(shouldInterceptChatEventClick('chat', click())).toBe(true)
	})

	it('carries reply attribution into its event details without changing URLs', () => {
		const selected = buildEventDetailData({ id: 'event-1', name: 'A show' } as EventWithVenue)
		const options = getEventDetailsGotoOptions(selected, {}, 'response-1')
		expect(getEventResponseId(options.state, 'event-1')).toBe('response-1')
		expect(getEventResponseId(options.state, 'event-2')).toBeUndefined()
		expect(getChatEventHref('/chat/conversation-1', 'event-1')).toBe('/chat/conversation-1?event=event-1')
	})

	it('clears inherited attribution when another event opens without reply context', () => {
		const original: App.PageState = { chatResponse: { eventId: 'event-1', responseId: 'response-1' } }
		const selected = buildEventDetailData({ id: 'event-2', name: 'Another show' } as EventWithVenue)
		const options = getEventDetailsGotoOptions(selected, original)
		expect(options.state.chatResponse).toBeUndefined()
		expect(original.chatResponse?.responseId).toBe('response-1')
	})

	it('leaves saved-page and modified clicks native', () => {
		expect(shouldInterceptChatEventClick('saved_page', click())).toBe(false)
		expect(shouldInterceptChatEventClick('chat', click({ metaKey: true }))).toBe(false)
		expect(shouldInterceptChatEventClick('chat', click({ ctrlKey: true }))).toBe(false)
		expect(shouldInterceptChatEventClick('chat', click({ button: 1 }))).toBe(false)
	})
})

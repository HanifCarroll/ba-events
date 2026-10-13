import type { buildEventDetailData } from './event-detail-data.ts'

type SelectedEvent = ReturnType<typeof buildEventDetailData>

export function getChatEventHref(pathname: string, eventId: string): string {
	return `${pathname}?event=${encodeURIComponent(eventId)}`
}

export function getEventDetailsGotoOptions(
	selectedEvent: SelectedEvent,
	state: App.PageState = {},
	responseId?: string
): { state: App.PageState; shallow: true } {
	const nextState: App.PageState = { ...state, selectedEvent: selectedEvent as App.PageState['selectedEvent'] }
	if (responseId) nextState.chatResponse = { eventId: selectedEvent.event.id, responseId }
	else delete nextState.chatResponse
	return {
		state: nextState,
		shallow: true
	}
}

/** Only the event opened from the reply inherits its attribution. Never a URL parameter. */
export function getEventResponseId(state: App.PageState, eventId: string): string | undefined {
	return state.chatResponse?.eventId === eventId ? state.chatResponse.responseId : undefined
}

export function shouldInterceptChatEventClick(
	source: 'chat' | 'saved_page',
	click: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>
): boolean {
	return (
		source === 'chat' &&
		click.button === 0 &&
		!click.metaKey &&
		!click.ctrlKey &&
		!click.shiftKey &&
		!click.altKey
	)
}

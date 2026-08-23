export function getChatEventHref(pathname: string, eventId: string): string {
	return `${pathname}?event=${encodeURIComponent(eventId)}`
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

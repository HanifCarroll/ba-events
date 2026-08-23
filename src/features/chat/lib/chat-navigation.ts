export function getChatConversationId(
	pathname: string,
	routeConversationId?: string
): string | null {
	if (routeConversationId) return routeConversationId
	const match = pathname.match(/^\/chat\/([^/]+)$/)
	return match ? decodeURIComponent(match[1]) : null
}

export function getChatHandoffNavigation(
	conversationId: string,
	state: App.PageState
): { url: string; state: App.PageState } {
	return {
		url: `/chat/${encodeURIComponent(conversationId)}`,
		state
	}
}

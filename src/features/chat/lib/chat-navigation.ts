export function getChatConversationId(
	pathname: string,
	routeConversationId?: string,
	stateConversationId?: string
): string | null {
	if (routeConversationId) return routeConversationId
	if (stateConversationId) return stateConversationId
	const match = pathname.match(/^\/chat\/([^/]+)$/)
	return match ? decodeURIComponent(match[1]) : null
}

export function getChatHandoffNavigation(
	conversationId: string,
	state: App.PageState
): { url: string; state: App.PageState } {
	return {
		url: `/chat/${encodeURIComponent(conversationId)}`,
		state: { ...state, chatConversationId: conversationId }
	}
}

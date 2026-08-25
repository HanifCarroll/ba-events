export function shouldAutoHandlePendingTurn(input: {
	conversationId: string | null
	pendingTurnId: string | null
	requestPhase: 'idle' | 'preparing' | 'thinking' | 'persisting' | 'error'
	chatReady: boolean
	attemptedTurnIds: ReadonlySet<string>
}) {
	return !!(
		input.conversationId &&
		input.pendingTurnId &&
		input.requestPhase === 'idle' &&
		input.chatReady &&
		!input.attemptedTurnIds.has(input.pendingTurnId)
	)
}

export function resetAttemptedTurnIds(
	attemptedTurnIds: Set<string>,
	conversationIdChanged: boolean
) {
	if (conversationIdChanged) attemptedTurnIds.clear()
}

export function shouldPersistUserMessage(turnId: string | null) {
	return turnId === null
}

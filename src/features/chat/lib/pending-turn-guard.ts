export function findRetryTurn<
	T extends { id: string; status: string }
>(turns: readonly T[], activeRetryTurnId: string | null): T | undefined {
	return turns.find(
		(turn) =>
			turn.id !== activeRetryTurnId &&
			(turn.status === 'failed' || turn.status === 'interrupted')
	)
}

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

export function markTurnAccepted(acceptedTurnIds: Set<string>, turnId: string) {
	if (acceptedTurnIds.has(turnId)) return false
	acceptedTurnIds.add(turnId)
	return true
}

export function adoptedPendingConversationId(
	pendingConversationId: string | null,
	currentConversationId: string | null
) {
	return pendingConversationId !== null && pendingConversationId === currentConversationId
}

export function ownsRunningGuestClaim(input: {
	status: string | undefined
	claimId: string | null
	returnedClaimId: string | null | undefined
}) {
	return input.status === 'running' && input.claimId !== null && input.claimId === input.returnedClaimId
}

import type { ChatInit, UIMessage } from 'ai'
import { completeGuestTurn, failGuestTurn } from '#shared/lib/db/guest-conversations.ts'
import type { CanonicalChatResponse, MessageExecutionStep } from '#shared/lib/types.ts'
import { canonicalFromDataResponse } from './canonical.ts'

export type RequestPhase = 'idle' | 'preparing' | 'thinking' | 'persisting' | 'error'

export class ChatTurnStoppedError extends Error {
	constructor() {
		super('Response stopped by the user')
		this.name = 'ChatTurnStoppedError'
	}
}

export interface ClientTurn {
	readonly conversationId: string
	readonly startingConversationId: string | null
	readonly turnId: string
	readonly userClientMessageId: string
	readonly assistantClientMessageId: string
	readonly claimId: string
	readonly userId: string | null
	readonly content: string
	readonly locale: 'en' | 'es'
}

export function ownsClientTurn(turn: ClientTurn, current: {
	activeTurn: ClientTurn | null
	conversationId: string | null
	userId: string | null
}) {
	return current.activeTurn === turn && current.userId === turn.userId &&
		(current.conversationId === turn.conversationId ||
			(current.conversationId === null && turn.startingConversationId === null))
}

export function canonicalFromParts(parts: ReadonlyArray<{ type?: string; data?: unknown }>) {
	const response = parts.find((part) => part.type === 'data-response')
	return response ? canonicalFromDataResponse(response.data) : null
}

/** One attempt owns its callbacks, including the SDK's finish-after-error callback. */
export function createTurnLifecycle(turn: ClientTurn, handlers: {
	isCurrent: () => boolean
	onPhase: (phase: RequestPhase) => void
	onFailure: (error: Error) => void
	onComplete: (canonical: CanonicalChatResponse) => void | Promise<void>
}) {
	let terminal = false
	let settled = Promise.resolve()
	let executionTrace: MessageExecutionStep[] = []
	const isCurrent = () => !terminal && handlers.isCurrent()

	async function recordFailure() {
		if (turn.userId !== null) return
		try {
			await failGuestTurn(turn.turnId, turn.claimId)
		} catch (error) {
			// An unavailable store leaves a bounded claim to expire for explicit retry.
			console.error('[chat] Failed to mark guest turn failed:', error)
		}
	}

	function fail(error: Error) {
		if (terminal) return
		terminal = true
		settled = recordFailure().then(() => {
			if (handlers.isCurrent()) handlers.onFailure(error)
		})
	}

	const callbacks: Pick<ChatInit<UIMessage>, 'onData' | 'onError' | 'onFinish'> = {
		onData(part) {
			if (!isCurrent()) return
			if (part.type === 'data-status') {
				const phase = (part.data as { phase?: string }).phase
				if (phase === 'thinking' || phase === 'persisting') handlers.onPhase(phase)
			} else if (part.type === 'data-execution-trace') {
				const steps = (part.data as { steps?: MessageExecutionStep[] }).steps
				if (Array.isArray(steps)) executionTrace = steps
			}
		},
		onError: (error) => fail(error),
		onFinish({ message, isAbort, isError, isDisconnect, finishReason }) {
			if (!isCurrent()) return
			if (isAbort || isError || isDisconnect || finishReason !== 'stop') {
				fail(new Error('The response was interrupted. Please retry this turn.'))
				return
			}
			const canonical = canonicalFromParts(message.parts)
			if (!canonical) {
				fail(new Error('The response was incomplete. Please retry this turn.'))
				return
			}
			terminal = true
			handlers.onPhase('persisting')
			// The SDK does not await onFinish; expose its persistence to the send owner.
			settled = (async () => {
				try {
					if (turn.userId === null) {
						await completeGuestTurn(turn.turnId, turn.claimId, { canonical, executionTrace })
					}
					if (handlers.isCurrent()) await handlers.onComplete(canonical)
				} catch (error) {
					await recordFailure()
					if (handlers.isCurrent()) {
						handlers.onFailure(error instanceof Error ? error : new Error('Failed to save response'))
					}
				}
			})()
		}
	}

	return {
		callbacks,
		fail,
		stop: () => {
			// Once canonical persistence begins, stopping cannot undo completion.
			if (terminal) return false
			fail(new ChatTurnStoppedError())
			return true
		},
		cancel: () => {
			terminal = true
			// Cancellation can race bootstrap/claim; repeated cleanup releases a late claim too.
			settled = settled.then(recordFailure)
		},
		settled: () => settled
	}
}

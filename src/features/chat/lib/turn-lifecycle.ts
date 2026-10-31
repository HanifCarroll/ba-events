import type { ChatInit, UIMessage } from 'ai'
import { createActor, type EventFromLogic } from 'xstate'
import { turnLifecycleMachine, type RequestPhase, type TurnLifecycleSnapshot } from './turn-lifecycle.machine.ts'
export { requestPhaseFor, type RequestPhase, type TurnLifecycleSnapshot } from './turn-lifecycle.machine.ts'
import { completeGuestTurn, failGuestTurn } from '#shared/lib/db/guest-conversations.ts'
import type { CanonicalChatResponse, MessageExecutionStep } from '#shared/lib/types.ts'
import { canonicalFromDataResponse } from './canonical.ts'
import { applyProgressText } from './progress.ts'

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
	onPhase?: (phase: RequestPhase) => void
	onSnapshot?: (snapshot: TurnLifecycleSnapshot) => void
	onFailure: (error: Error) => void
	onComplete: (canonical: CanonicalChatResponse) => void | Promise<void>
	onProgress?: (canonical: CanonicalChatResponse | null) => void
}) {
	// This attempt-local actor has no invoked work or timers. SDK/store promises
	// stay with the native caller; dropping the lifecycle releases the actor too.
	const actor = createActor(turnLifecycleMachine).start()
	const snapshot = () => actor.getSnapshot()
	const advance = (event: EventFromLogic<typeof turnLifecycleMachine>) => {
		if (!snapshot().can(event)) return false
		actor.send(event)
		if (handlers.isCurrent()) handlers.onSnapshot?.(snapshot())
		return true
	}
	handlers.onSnapshot?.(snapshot())
	let settled = Promise.resolve()
	let executionTrace: MessageExecutionStep[] = []
	let progress: CanonicalChatResponse | null = null
	let deferred: Array<() => void> = []
	const isCurrent = () => (snapshot().matches('running') || snapshot().matches('stopping')) && handlers.isCurrent()

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
		if (!advance({ type: 'FAIL' })) return
		handlers.onProgress?.(null)
		settled = recordFailure().then(() => {
			if (handlers.isCurrent()) handlers.onFailure(error)
		})
	}

	const callbacks: Pick<ChatInit<UIMessage>, 'onData' | 'onError' | 'onFinish'> = {
		onData(part) {
			if (!isCurrent()) return
			if (part.type === 'data-status') {
				const phase = (part.data as { phase?: string }).phase
				if (phase === 'thinking' || phase === 'persisting') {
					if (snapshot().matches('stopping')) {
						deferred.push(() => callbacks.onData?.(part))
					} else if (advance({ type: phase === 'thinking' ? 'THINK' : 'PERSIST' })) {
						handlers.onPhase?.(phase)
					}
				}
			} else if (part.type === 'data-execution-trace') {
				const steps = (part.data as { steps?: MessageExecutionStep[] }).steps
				if (Array.isArray(steps)) executionTrace = steps
			} else if (part.type === 'data-progress') {
				progress = canonicalFromDataResponse(part.data)
				if (progress) handlers.onProgress?.(progress)
			} else if (part.type === 'data-progress-text' && progress) {
				const next = applyProgressText(progress, part.data)
				if (next) { progress = next; handlers.onProgress?.(progress) }
			}
		},
		onError: (error) => { if (snapshot().matches('stopping')) deferred.push(() => fail(error)); else fail(error) },
		onFinish({ message, isAbort, isError, isDisconnect, finishReason }) {
			if (snapshot().matches('stopping')) {
				deferred.push(() => callbacks.onFinish?.({ message, isAbort, isError, isDisconnect, finishReason, messages: [message] }))
				return
			}
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
			if (!advance({ type: 'FINISH' })) return
			handlers.onProgress?.(null)
			handlers.onPhase?.('persisting')
			// The SDK does not await onFinish; expose its persistence to the send owner.
			settled = (async () => {
				try {
					if (turn.userId === null) {
						await completeGuestTurn(turn.turnId, turn.claimId, { canonical, executionTrace })
					}
					if (snapshot().matches('saving') && handlers.isCurrent()) {
						await handlers.onComplete(canonical)
					}
					advance({ type: 'SAVED' })
				} catch (error) {
					advance({ type: 'SAVE_FAILED' })
					await recordFailure()
					if (snapshot().matches('failed') && handlers.isCurrent()) {
						handlers.onFailure(error instanceof Error ? error : new Error('Failed to save response'))
					}
				}
			})()
		}
	}

	return {
		callbacks,
		fail,
		snapshot,
		think: () => { advance({ type: 'THINK' }) },
		completeFromStore: () => { advance({ type: 'FINISH' }); advance({ type: 'SAVED' }) },
		beginStop: () => advance({ type: 'BEGIN_STOP' }),
		endStop: (approved: boolean) => {
			const pending = deferred
			deferred = []
			if (approved) {
				if (advance({ type: 'STOP' })) {
					handlers.onProgress?.(null)
					settled = recordFailure().then(() => {
						if (handlers.isCurrent()) handlers.onFailure(new ChatTurnStoppedError())
					})
				} else if (snapshot().matches('detached') || snapshot().matches('cancelled')) {
					// Navigation can precede the authoritative Stop acknowledgement.
					settled = settled.then(recordFailure)
				}
			} else if (advance({ type: 'REJECT_STOP' })) {
				for (const callback of pending) callback()
			}
		},
		stop: () => {
			if (!advance({ type: 'STOP' })) return false
			handlers.onProgress?.(null)
			settled = recordFailure().then(() => {
				if (handlers.isCurrent()) handlers.onFailure(new ChatTurnStoppedError())
			})
			return true
		},
		cancel: () => {
			advance({ type: 'CANCEL' })
			// Repeated cleanup releases a claim acquired after preparation was cancelled.
			settled = settled.then(recordFailure)
		},
		detach: () => { advance({ type: 'DETACH' }) },
		settled: () => settled
	}
}

<script lang="ts">
	import type { HomeEventCard, HomeEventFeed } from '#features/events/lib/home-feed.ts'
	import { untrack } from 'svelte'
	import { RotateCw } from 'lucide-svelte'
	import { Chat } from '@ai-sdk/svelte'
	import { type UIMessage } from 'ai'
	import { createClientDelivery, saveClientDelivery, loadClientDelivery, clearClientDelivery, deliveryTransport, stopClientDelivery, type ClientDelivery } from '#features/chat/lib/delivery.ts'
	import { toast } from 'svelte-sonner'
	import { getLocale } from '#paraglide/runtime.js'
	import * as m from '#paraglide/messages.js'
	import { track } from '#shared/lib/analytics.ts'
	import { responseFeedbackContext } from '#features/chat/lib/response-feedback.ts'
	import { useAuthContext } from '#features/auth/hooks/auth-context.svelte.ts'
	import { chatState } from '#features/chat/state/chat.svelte.ts'
	import { extractVisibleTextFromUIMessageParts } from '#features/chat/lib/extract-visible-text.ts'
	import { warmRecommendationFallback } from '#shared/lib/recommendation-framing.ts'
	import {
		flushMessagePersistenceOutbox,
		getConversationTerminalFailures,
		type MessagePersistencePayload
	} from '#features/chat/lib/persistence-outbox.ts'
	import {
		bootstrapGuestTurn,
		claimGuestTurn,
		setGuestConversationTitle
	} from '#shared/lib/db/guest-conversations.ts'
	import type { GuestConversationWithMessages, GuestMessage } from '#shared/lib/db/guest-conversations.ts'
	import { sortMessagesByTurnOrderAsc } from '#features/chat/lib/message-order.ts'
	import { resolveMessageTimestamp } from '#features/chat/lib/message-timestamps.ts'
	import {
		findRetryTurn,
		shouldAutoHandlePendingTurn,
		resetAttemptedTurnIds,
		adoptedPendingConversationId,
		ownsRunningGuestClaim,
		ownsConversationSnapshot,
		markTurnAccepted
	} from '#features/chat/lib/pending-turn-guard.ts'
	import {
		adaptStoredMessageToCanonical,
		canonicalToRender
	} from '#features/chat/lib/canonical.ts'
	import { canonicalFromParts, ChatTurnStoppedError, createTurnLifecycle, ownsClientTurn, type ClientTurn, type RequestPhase } from '#features/chat/lib/turn-lifecycle.ts'
	import { getFallbackConversationTitle } from '#features/chat/lib/title.ts'
	import MessageList from './MessageList.svelte'
	import ChatInput from './ChatInput.svelte'
	import SuggestedPrompts from './SuggestedPrompts.svelte'
	import {
		CHAT_CONTRACT_VERSION,
		type ChatEventPayload,
		type ChatMessage,
		type ConversationWithMessages,
		type Message,
		type CanonicalChatResponse
	} from '#shared/lib/types.ts'

	interface ChatMessageMetadata {
		createdAt?: string
	}

	type ChatUIMessage = UIMessage<ChatMessageMetadata>

	let {
		conversationId = null as string | null,
		onConversationChange = undefined as ((id: string) => Promise<void>) | undefined,
		happeningSoonEvents = undefined as HomeEventFeed | undefined,
		preloadedConversation = null as ConversationWithMessages | null,
		pendingTurns = [] as Array<{
			id: string
			status: string
			content: string
			user_client_message_id: string
			assistant_client_message_id: string
		}>,
		showLanding = true
	}: {
		conversationId?: string | null
		onConversationChange?: (id: string) => Promise<void>
		happeningSoonEvents?: HomeEventFeed
		preloadedConversation?: ConversationWithMessages | null
		pendingTurns?: Array<{
			id: string
			status: string
			content: string
			user_client_message_id: string
			assistant_client_message_id: string
		}>
		showLanding?: boolean
	} = $props()

	// Resolve streamed cards for first-turn context without blocking sending a message.
	let streamedHomeEvents = $state.raw<HomeEventCard[]>([])
	const resolvedHomeEvents = $derived(Array.isArray(happeningSoonEvents) ? happeningSoonEvents : streamedHomeEvents)
	$effect(() => {
		const feed = happeningSoonEvents
		if (!feed || Array.isArray(feed)) return
		let active = true
		void feed.then((events) => { if (active) streamedHomeEvents = events })
		return () => { active = false }
	})

	const auth = useAuthContext()
	const userId = $derived(auth.user?.id ?? null)
	const isAuthenticated = $derived(userId !== null)
	const authenticatedConversation = $derived(
		ownsConversationSnapshot(preloadedConversation, conversationId, userId) ? preloadedConversation : null
	)

	// ==========================================================================
	// Rendered state
	// ==========================================================================
	let error = $state<string | null>(null)
	let noticeIsStopped = $state(false)
	let requestPhase = $state<RequestPhase>('idle')
	let progressiveResponse = $state<CanonicalChatResponse | null>(null)
	let guestConversation = $state<GuestConversationWithMessages | null>(null)
	let isLoadingGuestConversation = $state(false)
	let scrollContainerRef = $state<HTMLDivElement | null>(null)

	// ==========================================================================
	// Non-rendered refs
	// ==========================================================================
	let messageTimestampsById = new Map<string, Date>()
	let activeTurn: ClientTurn | null = null
	let activeLifecycle: ReturnType<typeof createTurnLifecycle> | null = null
	let activeDelivery: ClientDelivery | null = null
	let prevConversationIdRef: string | null = untrack(() => conversationId)
	let prevUserIdRef = untrack(() => userId)
	let attemptedTurnIdsRef = new Set<string>()
	let acceptedAnalyticsTurnIdsRef = new Set<string>()
	let isFirstExchangeRef = true
	let isFlushingOutboxRef = false
	let restoredScrollConversationIdRef: string | null = null
	const durableTurns = $derived(isAuthenticated
		? (authenticatedConversation ? pendingTurns : [])
		: (guestConversation?.conversation.id === conversationId ? guestConversation.turns ?? [] : []))
	let activeRetryTurnId = $state<string | null>(null)
	let localRetryTurn = $state<{
		id: string
		conversation_id: string
		content: string
		status: 'failed'
		claim_id: string | null
		user_client_message_id: string
		assistant_client_message_id: string
	} | null>(null)
	const retryTurn = $derived(findRetryTurn(durableTurns, activeRetryTurnId))
	const visibleRetryTurn = $derived(localRetryTurn ?? retryTurn)

	// ==========================================================================
	// Pure helpers
	// ==========================================================================
	function storedMessagesToUI(messages: ReadonlyArray<Message | GuestMessage>): ChatUIMessage[] {
		return messages.map((message) => ({
			id: message.client_message_id ?? message.id,
			role: message.role as 'user' | 'assistant',
			metadata: { createdAt: message.created_at },
			parts: [
				{ type: 'text' as const, text: message.visible_content ?? message.content },
				...(message.role === 'assistant'
					? [{ type: 'data-response' as const, data: adaptStoredMessageToCanonical(message) }]
					: [])
			]
		}))
	}

	type AssistantVisibilityMessage = Pick<
		ChatMessage,
		'content' | 'events' | 'directions' | 'venue' | 'operations'
	>

	function assistantMessageHasVisibleContent(
		message: AssistantVisibilityMessage | null | undefined
	): boolean {
		if (!message) return false
		return !!(
			message.content.trim().length > 0 ||
			(message.events && message.events.length > 0) ||
			message.directions ||
			message.venue ||
			(message.operations && message.operations.length > 0)
		)
	}

	function shouldShowLoadingIndicator(
		status: 'submitted' | 'streaming' | 'ready' | 'error',
		lastAssistantMessage: AssistantVisibilityMessage | null | undefined,
		phase: RequestPhase
	): boolean {
		const hasVisibleAssistantContent = assistantMessageHasVisibleContent(lastAssistantMessage)
		if (hasVisibleAssistantContent) return false
		if (phase === 'error') return false
		if (phase !== 'idle') return true
		return status === 'submitted' || status === 'streaming'
	}

	// ==========================================================================
	// Request lifecycle / correlations
	// ==========================================================================
	function isCurrentTurn(turn: ClientTurn) {
		return ownsClientTurn(turn, { activeTurn, conversationId, userId })
	}

	async function bootstrapTurn(turn: ClientTurn) {
		const input = {
			conversationId: turn.conversationId,
			turnId: turn.turnId,
			userClientMessageId: turn.userClientMessageId,
			assistantClientMessageId: turn.assistantClientMessageId,
			content: turn.content,
			locale: turn.locale
		}
		if (turn.userId !== null) {
			const response = await fetch('/api/chat/bootstrap', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(input)
			})
			if (!response.ok) throw new Error('Failed to save chat turn')
		} else {
			await bootstrapGuestTurn(input)
		}
	}


	// ==========================================================================
	// Persistence
	// ==========================================================================
	async function persistMessageToConversation(
		payload: MessagePersistencePayload
	): Promise<{ id?: string } | void> {
		const savedMessage = await chatState.addMessage({
			conversationId: payload.conversationId,
			parentMessageId: payload.parentMessageId,
			role: payload.role,
			clientMessageId: payload.clientMessageId,
			content: payload.content,
			visibleContent: payload.visibleContent ?? payload.content,
			executionTrace: payload.executionTrace,
			responseContractVersion: payload.responseContractVersion ?? CHAT_CONTRACT_VERSION,
			attachedData: payload.attachedData
		})

		return typeof savedMessage?.id === 'string' ? { id: savedMessage.id } : undefined
	}

	async function flushOutboxNow() {
		if (!isAuthenticated || isFlushingOutboxRef) return

		isFlushingOutboxRef = true

		try {
			const result = await flushMessagePersistenceOutbox(persistMessageToConversation)

			const visibleFailures = getConversationTerminalFailures(
				result.terminalFailures,
				conversationId
			)
			if (visibleFailures.length > 0) {
				const count = visibleFailures.length
				toast.warning('Unable to sync some chat messages', {
					description:
						count === 1
							? 'One message could not be saved after multiple retries.'
							: `${count} messages could not be saved after multiple retries.`
				})
			}
		} catch (flushError) {
			console.error('[chat] Failed to flush persistence outbox:', flushError)
		} finally {
			isFlushingOutboxRef = false
		}
	}

	// ==========================================================================
	// Streaming client
	// ==========================================================================
	let chat = $state.raw(new Chat<ChatUIMessage>({ id: 'ba-events-chat' }))

	function cancelActiveTurn() {
		if (activeDelivery) activeLifecycle?.detach()
		else activeLifecycle?.cancel()
		activeTurn = null
		activeLifecycle = null
		activeDelivery = null
		progressiveResponse = null
		void chat.stop()
	}

	async function handleStopResponse() {
		const lifecycle = activeLifecycle
		const requestChat = chat
		const delivery = activeDelivery
		const stoppedTurn = activeTurn
		if (delivery) {
			if (!lifecycle?.beginStop()) return
			try {
				const approved = await stopClientDelivery(delivery)
				lifecycle.endStop(approved)
				if (!approved) return
				clearClientDelivery(delivery)
			} catch {
				lifecycle.endStop(false)
				if (stoppedTurn && isCurrentTurn(stoppedTurn)) error = m.chat_error_generic()
				return
			}
		} else {
			if (!lifecycle?.stop()) return
		}
		await Promise.all([requestChat.stop(), lifecycle.settled()])
	}

	function resetConversationState() {
		cancelActiveTurn()
		// A stopped SDK request may still finish; keep it attached to its old Chat instance.
		chat = new Chat<ChatUIMessage>({ id: 'ba-events-chat' })
		messageTimestampsById.clear()
		activeRetryTurnId = null
		localRetryTurn = null
		isFirstExchangeRef = true
		requestPhase = 'idle'
		error = null
		noticeIsStopped = false
	}

	async function handleSendMessage(
		content: string,
		options?: {
			eventId?: string
			happeningSoonEventIds?: string[]
			conversationId?: string
			userClientMessageId?: string
			assistantClientMessageId?: string
			turnId?: string
			retry?: boolean
			delivery?: ClientDelivery
		}
	) {
		const retry = options?.retry === true
		const resuming = options?.delivery
		if (activeTurn || (requestPhase !== 'idle' && !retry)) return
		const turn: ClientTurn = resuming ? { ...resuming.turn, startingConversationId: conversationId } : {
			conversationId: (retry ? options?.conversationId : conversationId) ?? conversationId ?? options?.conversationId ?? crypto.randomUUID(),
			startingConversationId: conversationId,
			turnId: options?.turnId ?? crypto.randomUUID(),
			userClientMessageId: options?.userClientMessageId ?? crypto.randomUUID(),
			assistantClientMessageId: options?.assistantClientMessageId ?? crypto.randomUUID(),
			claimId: crypto.randomUUID(),
			userId,
			content,
			locale: getLocale().startsWith('es') ? 'es' : 'en'
		}
		const startedAt = Date.now()
		const hasHistory = chat.messages.length > 0
		const homeEventIds = !chat.messages.some((message) => message.role === 'assistant')
			? options?.happeningSoonEventIds ?? resolvedHomeEvents.slice(0, 4).map((event) => event.id)
			: undefined
		activeTurn = turn
		progressiveResponse = null
		attemptedTurnIdsRef.add(turn.turnId)
		activeRetryTurnId = retry ? turn.turnId : null
		localRetryTurn = null
		error = null
		noticeIsStopped = false
		requestPhase = 'preparing'

		async function showCompletedTurn(canonical: NonNullable<ReturnType<typeof canonicalFromParts>>) {
			const stored = turn.userId === null ? await chatState.getGuestConversation(turn.conversationId) : null
			if (!isCurrentTurn(turn)) return
			if (turn.userId === null) guestConversation = stored
			track('chat:response_received', { duration_ms: Date.now() - startedAt, events_returned: canonical.events.length, response_id: canonical.requestId, response_kind: canonical.kind })
			if (isFirstExchangeRef) {
				isFirstExchangeRef = false
				const title = turn.userId === null
					? setGuestConversationTitle(turn.conversationId, getFallbackConversationTitle(turn.content))
					: chatState.generateTitle({ conversationId: turn.conversationId, firstMessage: turn.content })
				void title.catch((error) => console.error('[chat] Failed to generate title:', error))
			}
			localRetryTurn = null
			if (activeDelivery) clearClientDelivery(activeDelivery)
			activeDelivery = null
			activeTurn = null
			activeLifecycle = null
			requestPhase = 'idle'
			void flushOutboxNow()
		}

		const lifecycle = createTurnLifecycle(turn, {
			isCurrent: () => isCurrentTurn(turn),
			onPhase: (phase) => { requestPhase = phase },
			onComplete: showCompletedTurn,
			onProgress: (response) => { if (isCurrentTurn(turn)) progressiveResponse = response },
			onFailure: (failure) => {
				// Preparation can fail or be stopped before the SDK adds the user message.
				if (!chat.messages.some((message) => message.id === turn.userClientMessageId)) {
					chat.messages = [...chat.messages, {
						id: turn.userClientMessageId, role: 'user',
						parts: [{ type: 'text', text: turn.content }],
						metadata: { createdAt: new Date().toISOString() }
					}]
				}
				localRetryTurn = {
					id: turn.turnId,
					conversation_id: turn.conversationId,
					content: turn.content,
					status: 'failed',
					claim_id: turn.claimId,
					user_client_message_id: turn.userClientMessageId,
					assistant_client_message_id: turn.assistantClientMessageId
				}
				activeTurn = null
				activeLifecycle = null
				if (activeDelivery) clearClientDelivery(activeDelivery)
				activeDelivery = null
				requestPhase = 'error'
				noticeIsStopped = failure instanceof ChatTurnStoppedError
				error = noticeIsStopped ? m.chat_response_stopped() : m.chat_error_generic()
				if (!noticeIsStopped) {
					track('chat:error', { error_type: acceptedAnalyticsTurnIdsRef.has(turn.turnId) ? 'client_error' : 'preflight_error' })
				}
			}
		})
		activeLifecycle = lifecycle
		const delivery = resuming ?? createClientDelivery(turn)
		const turnChat = new Chat<ChatUIMessage>({
			id: turn.turnId,
			messages: [...chat.messages],
			transport: deliveryTransport<ChatUIMessage>(delivery),
			...lifecycle.callbacks
		})
		chat = turnChat
		if (resuming) activeDelivery = delivery
		function stillCurrent() {
			if (isCurrentTurn(turn)) return true
			if (resuming) lifecycle.detach()
			else lifecycle.cancel()
			return false
		}

		try {
			if (resuming) {
				if (turn.userId === null) {
					const stored = await chatState.getGuestConversation(turn.conversationId)
					if (!stillCurrent()) return
					const claimed = stored?.turns?.find((item) => item.id === turn.turnId)
					if (claimed?.status === 'completed') { clearClientDelivery(delivery); activeDelivery = null; requestPhase = 'idle'; activeTurn = null; activeLifecycle = null; return }
					if (!ownsRunningGuestClaim({ status: claimed?.status, claimId: turn.claimId, returnedClaimId: claimed?.claim_id })) throw new Error('Chat claim expired or superseded')
				}
				activeDelivery = delivery
				requestPhase = 'thinking'
				await turnChat.resumeStream()
				await lifecycle.settled()
				return
			}
			await bootstrapTurn(turn)
			if (!stillCurrent()) return
			if (!conversationId) {
				turnChat.messages = [{ id: turn.userClientMessageId, role: 'user', parts: [{ type: 'text', text: content }], metadata: { createdAt: new Date().toISOString() } }]
				await onConversationChange?.(turn.conversationId)
				if (!stillCurrent()) return
				if (!adoptedPendingConversationId(turn.conversationId, conversationId)) {
					throw new Error('Chat navigation did not adopt the new conversation')
				}
			}
			if (turn.userId === null) {
				const claimed = await claimGuestTurn(turn.turnId, turn.claimId, retry)
				if (!stillCurrent()) return
				if (claimed?.status === 'completed') {
					const stored = await chatState.getGuestConversation(turn.conversationId)
					if (!stillCurrent()) return
					const assistant = stored?.messages.find((message) => message.client_message_id === turn.assistantClientMessageId)
					if (!stored || !assistant) throw new Error('The saved response is unavailable')
					turnChat.messages = storedMessagesToUI(stored.messages)
					await showCompletedTurn(adaptStoredMessageToCanonical(assistant))
					return
				}
				if (!ownsRunningGuestClaim({ status: claimed?.status, claimId: turn.claimId, returnedClaimId: claimed?.claim_id })) {
					throw new Error('This turn is already running or needs explicit retry')
				}
			}
			if (markTurnAccepted(acceptedAnalyticsTurnIdsRef, turn.turnId)) {
				track('chat:message_sent', { message_length: content.length, has_history: hasHistory })
			}
			const body = {
				conversationId: turn.conversationId,
				turnId: turn.turnId,
				userClientMessageId: turn.userClientMessageId,
				assistantClientMessageId: turn.assistantClientMessageId,
				locale: turn.locale,
				retry,
				...(options?.eventId ? { happeningSoonEventId: options.eventId } : {}),
				...(homeEventIds?.length ? { happeningSoonEventIds: homeEventIds } : {})
			}
			const metadata = { createdAt: new Date().toISOString() }
			activeDelivery = delivery
			saveClientDelivery(delivery)
			requestPhase = 'thinking'
			if (turnChat.messages.some((message) => message.id === turn.userClientMessageId)) {
				await turnChat.sendMessage({ text: content, messageId: turn.userClientMessageId, metadata }, { body })
			} else {
				await turnChat.sendMessage({ id: turn.userClientMessageId, role: 'user', parts: [{ type: 'text', text: content }], metadata }, { body })
			}
			await lifecycle.settled()
		} catch (failure) {
			lifecycle.fail(failure instanceof Error ? failure : new Error('Failed to send message'))
			await lifecycle.settled()
		}
	}

	// ==========================================================================
	// Effects
	// ==========================================================================
	$effect(() => {
		const id = conversationId ?? null
		if (isAuthenticated) {
			guestConversation = null
			isLoadingGuestConversation = false
			return
		}
		if (!id) {
			guestConversation = null
			isLoadingGuestConversation = false
			return
		}

		guestConversation = null
		isLoadingGuestConversation = true
		let cancelled = false
		chatState.getGuestConversation(id).then(async (result) => {
			if (cancelled) return
			guestConversation = result
			isLoadingGuestConversation = false
		})

		return () => {
			cancelled = true
		}
	})

	$effect(() => {
		const identityChanged = conversationId !== prevConversationIdRef || userId !== prevUserIdRef
		const adopting = userId === prevUserIdRef &&
			adoptedPendingConversationId(activeTurn?.conversationId ?? null, conversationId)
		prevConversationIdRef = conversationId
		prevUserIdRef = userId
		if (identityChanged && !adopting) {
			resetAttemptedTurnIds(attemptedTurnIdsRef, true)
			untrack(resetConversationState)
		}
		// Finishing a stream must not reload the pre-request server snapshot over its reply.
		const phase = untrack(() => requestPhase)
		if (phase !== 'idle' && phase !== 'error') return
		if (!conversationId || activeTurn || (!isAuthenticated && isLoadingGuestConversation)) return

		const sourceMessages = isAuthenticated
			? authenticatedConversation?.messages
			: guestConversation?.messages
		if (!sourceMessages || sourceMessages.length === 0) return

		const sortedMessages = isAuthenticated
			? sortMessagesByTurnOrderAsc(sourceMessages as Message[])
			: [...sourceMessages].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))

		chat.messages = storedMessagesToUI(sortedMessages)

		const title = isAuthenticated ? authenticatedConversation?.title : guestConversation?.conversation.title
		isFirstExchangeRef = sortedMessages.length <= 1 && (!title || title === 'New conversation')
	})

	$effect(() => {
		void flushOutboxNow()
	})

	$effect(() => {
		if (!isAuthenticated) return

		const handleOnline = () => {
			void flushOutboxNow()
		}

		window.addEventListener('online', handleOnline)
		return () => {
			window.removeEventListener('online', handleOnline)
		}
	})

	$effect(() => {
		const unregister = chatState.registerStartNewChatHandler(resetConversationState)
		return () => {
			unregister()
			cancelActiveTurn()
		}
	})

	$effect(() => {
		if (!conversationId || activeTurn || isLoadingGuestConversation ||
			(isAuthenticated && !authenticatedConversation) || requestPhase !== 'idle') return
		const delivery = loadClientDelivery(conversationId, userId)
		if (!delivery || attemptedTurnIdsRef.has(delivery.turn.turnId)) return
		if (durableTurns.some((turn) => turn.id === delivery.turn.turnId && turn.status === 'completed')) {
			clearClientDelivery(delivery)
			return
		}
		attemptedTurnIdsRef.add(delivery.turn.turnId)
		untrack(() => void handleSendMessage(delivery.turn.content, { delivery }))
	})

	$effect(() => {
		const pending = durableTurns.find((turn) => turn.status === 'pending')
		if (!shouldAutoHandlePendingTurn({
			conversationId,
			pendingTurnId: pending?.id ?? null,
			requestPhase: requestPhase,
			chatReady: chat.status === 'ready',
			attemptedTurnIds: attemptedTurnIdsRef
		})) return
		if (!pending) return
		attemptedTurnIdsRef.add(pending.id)
		untrack(() => void handleSendMessage(pending.content, {
			conversationId: conversationId ?? undefined,
			turnId: pending.id,
			userClientMessageId: pending.user_client_message_id,
			assistantClientMessageId: pending.assistant_client_message_id
		}))
	})

	function handleConversationScroll(event: Event) {
		if (!conversationId || restoredScrollConversationIdRef !== conversationId) {
			return
		}
		const target = event.currentTarget as HTMLDivElement
		chatState.saveConversationScrollPosition(conversationId, target.scrollTop)
	}

	$effect(() => {
		if (
			!conversationId ||
			displayMessages.length === 0 ||
			restoredScrollConversationIdRef === conversationId
		) {
			return
		}

		const savedScrollTop = chatState.getConversationScrollPosition(conversationId)
		const frame = window.requestAnimationFrame(() => {
			const scrollContainer = scrollContainerRef
			if (!scrollContainer) return

			restoredScrollConversationIdRef = conversationId
			if (savedScrollTop !== null) {
				scrollContainer.scrollTop = savedScrollTop
			}
		})

		return () => window.cancelAnimationFrame(frame)
	})

	// ==========================================================================
	// Derived display state
	// ==========================================================================
	const chatMessages = $derived.by(() => {
		return chat.messages.map((message, index) => {
			const parts = message.parts as Array<{ type?: string; text?: string; data?: unknown }>
			const textContent = extractVisibleTextFromUIMessageParts(parts)
			const isLastAssistant =
				message.role === 'assistant' && index === chat.messages.length - 1
			const isStreaming = isLastAssistant && chat.status === 'streaming'
			const completedCanonical = message.role === 'assistant' ? canonicalFromParts(parts) : null
			const canonical = completedCanonical ?? (isLastAssistant ? progressiveResponse : null)
			const render = canonical
				? canonicalToRender(canonical)
				: {
						events: [],
						suggestions: [],
						directions: null,
						venue: null,
						operations: [],
						clarificationQuestions: [],
						framing: null
					}
			const recommendationNextStep =
				canonical?.kind === 'recommendations' && render.events.length > 0
					? render.framing?.nextStep ??
						warmRecommendationFallback(
							getLocale().startsWith('es') ? 'es' : 'en',
							render.events.length
						).nextStep
					: undefined

			return {
				id: message.id,
				role: message.role as 'user' | 'assistant',
				content: canonical?.text ?? textContent,
				timestamp: resolveMessageTimestamp(message, messageTimestampsById),
				isStreaming,
				responseFeedback: responseFeedbackContext(completedCanonical, isStreaming || (isLastAssistant && requestPhase !== 'idle')),
				events: render.events.length > 0 ? render.events : undefined,
				suggestions: render.suggestions.length > 0 ? render.suggestions : undefined,
				directions: render.directions ?? undefined,
				venue: render.venue ?? undefined,
				operations: render.operations.length > 0 ? render.operations : undefined,
				recommendationNextStep,
				clarificationQuestions:
					render.clarificationQuestions.length > 0 ? render.clarificationQuestions : undefined
			} satisfies ChatMessage
		})
	})

	const displayMessages = $derived.by(() => {
		const visible = chatMessages.filter((chatMessage) => {
			if (chatMessage.role === 'user') return true
			const hasVisibleContent =
				chatMessage.content.trim().length > 0 ||
				(chatMessage.events && chatMessage.events.length > 0) ||
				chatMessage.directions ||
				chatMessage.venue ||
				(chatMessage.operations && chatMessage.operations.length > 0)
			return hasVisibleContent || chatMessage.isStreaming
		})

		return visible
	})

	const hasMessages = $derived(displayMessages.length > 0)
	const lastAssistantMessage = $derived(
		[...chatMessages].reverse().find((message) => message.role === 'assistant')
	)
	const showLoading = $derived(
		shouldShowLoadingIndicator(chat.status, lastAssistantMessage, requestPhase)
	)

	const isLoading = $derived(
		chat.status === 'submitted' ||
			chat.status === 'streaming' ||
			(requestPhase !== 'idle' && requestPhase !== 'error')
	)
	const canStop = $derived(isLoading && requestPhase !== 'persisting' && requestPhase !== 'error')

	const showNotice = $derived(Boolean(error || (visibleRetryTurn && !isLoading)))
	const noticeMessageId = $derived.by(() => {
		const id = visibleRetryTurn?.user_client_message_id
		if (!showNotice || !id) return null
		return displayMessages.some((message) => message.role === 'user' && message.id === id)
			? id
			: null
	})

	const loadingLabel = $derived.by(() => {
		switch (requestPhase) {
			case 'preparing':
				return m.chat_status_preparing()
			case 'thinking':
				return m.chat_status_thinking()
			case 'persisting':
				return m.chat_status_persisting()
			case 'error':
				return m.chat_status_error()
			case 'idle':
			default:
				return m.chat_thinking()
		}
	})

	const isHome = $derived(
		showLanding && !conversationId && !hasMessages && requestPhase === 'idle'
	)

	const showConversationLoading = $derived(
		!!(
			conversationId &&
			(isAuthenticated ? false : isLoadingGuestConversation) &&
			requestPhase === 'idle' &&
			!hasMessages
		)
	)

	const conversationMissing = $derived(
		!!(
			conversationId &&
			!(isAuthenticated ? false : isLoadingGuestConversation) &&
			!(isAuthenticated ? !!authenticatedConversation : !!guestConversation) &&
			requestPhase === 'idle' &&
			!hasMessages
		)
	)

</script>

{#snippet responseNotice()}
	<div
		role={error && !noticeIsStopped ? 'alert' : 'status'}
		class="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[13px] text-muted-foreground"
	>
		<span class="min-w-0">{error ?? m.chat_retry_needed()}</span>
		{#if visibleRetryTurn && !isLoading}
			<button
				type="button"
				class="-mr-2 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onclick={() => handleSendMessage(visibleRetryTurn.content, {
					conversationId: localRetryTurn?.conversation_id ?? conversationId ?? undefined,
					turnId: visibleRetryTurn.id,
					userClientMessageId: visibleRetryTurn.user_client_message_id,
					assistantClientMessageId: visibleRetryTurn.assistant_client_message_id,
					retry: true
				})}
			>
				<RotateCw class="size-4" aria-hidden="true" />
				{m.chat_retry()}
			</button>
		{/if}
	</div>
{/snippet}

<div class="relative h-full min-h-0 flex flex-col">
	{#if showNotice && !noticeMessageId}
		<div class="shrink-0 mx-4 mt-4">
			{@render responseNotice()}
		</div>
	{/if}

	<div
		bind:this={scrollContainerRef}
		onscroll={handleConversationScroll}
		class="flex-1 min-h-0 overflow-y-auto"
	>
		{#if showConversationLoading}
			<div class="flex items-center justify-center h-full">
				<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
			</div>
		{:else if conversationMissing}
			<div class="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
				<p class="text-muted-foreground">
					{isAuthenticated
						? m.chat_conversation_not_found()
						: m.chat_guest_conversation_not_found()}
				</p>
				<a
					href="/"
					class="text-sm font-medium text-primary hover:underline"
				>
					{m.chat_start_new_chat()}
				</a>
			</div>
		{:else if hasMessages || requestPhase !== 'idle'}
			<MessageList
				messages={displayMessages}
				{noticeMessageId}
				messageNotice={responseNotice}
				isLoading={showLoading}
				loadingPhase={requestPhase}
				loadingLabel={loadingLabel}
				onSuggestionSelect={handleSendMessage}
			/>
		{:else if showLanding}
			<SuggestedPrompts
				onSelectPrompt={handleSendMessage}
				happeningSoonEvents={happeningSoonEvents}
			/>
		{/if}
	</div>

	{#if !isHome}
		<div class="shrink-0 bg-background">
			{#key `${isAuthenticated}:${conversationId ?? ''}`}
				<ChatInput
					onSend={handleSendMessage}
					onStop={handleStopResponse}
					{canStop}
					disabled={isLoading || showConversationLoading}
					emphasized={!hasMessages && requestPhase === 'idle' && !conversationId}
				/>
			{/key}
		</div>
	{/if}
</div>

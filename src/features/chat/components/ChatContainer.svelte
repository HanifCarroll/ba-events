<script lang="ts">
	import { untrack } from 'svelte'
	import { Chat } from '@ai-sdk/svelte'
	import { DefaultChatTransport, generateId, type UIMessage } from 'ai'
	import { toast } from 'svelte-sonner'
	import { getLocale } from '#paraglide/runtime.js'
	import * as m from '#paraglide/messages.js'
	import { track } from '#shared/lib/analytics.ts'
	import { useAuthContext } from '#features/auth/hooks/auth-context.svelte.ts'
	import { chatState, type PendingFirstMessage } from '#features/chat/state/chat.svelte.ts'
	import { extractVisibleTextFromUIMessageParts } from '#features/chat/lib/extract-visible-text.ts'
	import {
		flushMessagePersistenceOutbox,
		persistMessageWithOutbox,
		type MessagePersistencePayload,
		type MessagePersistenceResult
	} from '#features/chat/lib/persistence-outbox.ts'
	import {
		addGuestMessage,
		createGuestConversation
	} from '#shared/lib/db/guest-conversations.ts'
	import type { GuestConversationWithMessages } from '#shared/lib/db/guest-conversations.ts'
	import { sortMessagesByTurnOrderAsc } from '#features/chat/lib/message-order.ts'
	import { resolveMessageTimestamp } from '#features/chat/lib/message-timestamps.ts'
	import {
		markHandoffPhaseTime,
		readHandoffMarkTime,
		type HandoffPhase
	} from '#features/chat/lib/handoff-marks.ts'
	import { adaptLegacyToCanonical, canonicalToRender } from '#features/chat/lib/canonical.ts'
	import MessageList from './MessageList.svelte'
	import ChatInput from './ChatInput.svelte'
	import SuggestedPrompts, { type HomeTimeContext } from './SuggestedPrompts.svelte'
	import type {
		CanonicalChatResponse,
		ChatEventPayload,
		ChatMessage,
		ChatStreamStatusPhase,
		ConversationWithMessages,
		Message,
		MessageExecutionStep
	} from '#shared/lib/types.ts'

	interface ChatMessageMetadata {
		createdAt?: string
	}

	type ChatUIMessage = UIMessage<ChatMessageMetadata>

	type RequestPhase =
		| 'idle'
		| 'preparing'
		| 'thinking'
		| 'running_tool'
		| 'composing'
		| 'persisting'
		| 'error'

	let {
		conversationId = null as string | null,
		onConversationChange = undefined as ((id: string) => void) | undefined,
		happeningSoonEvents = undefined as ChatEventPayload[] | undefined,
		preloadedConversation = null as ConversationWithMessages | null
	}: {
		conversationId?: string | null
		onConversationChange?: (id: string) => void
		happeningSoonEvents?: ChatEventPayload[]
		preloadedConversation?: ConversationWithMessages | null
	} = $props()

	const auth = useAuthContext()
	const isAuthenticated = $derived(!!auth.user)

	// ==========================================================================
	// Rendered state
	// ==========================================================================
	let error = $state<string | null>(null)
	let homeTimeContext = $state<HomeTimeContext>(null)
	let pendingFirstMessage = $state<PendingFirstMessage | null>(null)
	let isHandoffPending = $state(false)
	let requestPhase = $state<RequestPhase>('idle')
	let guestConversation = $state<GuestConversationWithMessages | null>(null)
	let isLoadingGuestConversation = $state(false)
	let scrollContainerRef = $state<HTMLDivElement | null>(null)

	// ==========================================================================
	// Non-rendered refs
	// ==========================================================================
	let messageTimestampsById = new Map<string, Date>()
	let startTimeRef = 0
	let eventsCountRef = 0

	type HandoffMarks = Partial<Record<HandoffPhase, number>>
	let handoffMarksRef: HandoffMarks = {}
	let activeHandoffIdRef: string | null = null
	let isHandoffRequestRef = false

	let requestPhaseRef: RequestPhase = 'idle'

	let activeRequestIdRef: string | null = null
	let pendingExecutionTraceByRequestIdRef = new Map<string, MessageExecutionStep[]>()
	let executionTraceByAssistantIdRef = new Map<string, MessageExecutionStep[]>()
	let prevConversationIdRef: string | null | undefined = untrack(() => conversationId)

	let pendingHappeningSoonEventIdRef: string | null = null
	let pendingUserMessageRef: string | null = null
	let pendingConversationIdRef: string | null = null
	let pendingAssistantClientMessageIdRef: string | null = null
	let pendingUserClientMessageIdRef: string | null = null
	let pendingUserPersistencePromiseRef: Promise<MessagePersistenceResult> | null = null
	let pendingUserPersistedMessageIdRef: string | null = null
	let persistedAssistantMessageIdsRef = new Map<string, string>()
	let isFirstExchangeRef = true
	let isFlushingOutboxRef = false
	let restoredScrollConversationIdRef: string | null = null

	// ==========================================================================
	// Pure helpers
	// ==========================================================================
	function mapStatusPhaseToRequestPhase(phase: ChatStreamStatusPhase): RequestPhase {
		switch (phase) {
			case 'thinking':
				return 'thinking'
			case 'calling_tool':
				return 'running_tool'
			case 'finalizing':
			case 'validating':
				return 'composing'
			case 'persisting':
				return 'persisting'
			case 'done':
				return 'persisting'
			case 'error':
				return 'error'
			default:
				return 'thinking'
		}
	}

	function canonicalFromParts(
		parts: Array<{ type?: string; data?: unknown }> | undefined
	): CanonicalChatResponse | null {
		if (!parts) return null
		for (const part of parts) {
			if (part.type === 'data-response' && part.data && typeof part.data === 'object') {
				return part.data as CanonicalChatResponse
			}
		}
		return null
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
	function setRequestLifecyclePhase(phase: RequestPhase) {
		requestPhaseRef = phase
		requestPhase = phase
	}

	function resetRequestCorrelations() {
		activeRequestIdRef = null
		pendingExecutionTraceByRequestIdRef.clear()
	}

	function markHandoffPhase(phase: HandoffPhase, handoffId?: string) {
		const id = handoffId ?? activeHandoffIdRef
		if (!id) return
		const time = markHandoffPhaseTime(id, phase)
		if (time !== null) {
			handoffMarksRef[phase] = time
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
			responseContractVersion: payload.responseContractVersion ?? 3,
			attachedData: payload.attachedData
		})

		return typeof savedMessage?.id === 'string' ? { id: savedMessage.id } : undefined
	}

	async function persistMessageResiliently(
		payload: MessagePersistencePayload
	): Promise<MessagePersistenceResult> {
		if (!isAuthenticated) {
			await addGuestMessage(payload.conversationId, {
				id: payload.clientMessageId,
				clientMessageId: payload.clientMessageId,
				parentMessageId: payload.parentMessageId,
				role: payload.role,
				content: payload.content,
				visibleContent: payload.visibleContent ?? payload.content,
				executionTrace: payload.executionTrace,
				attachedData: payload.attachedData,
				responseContractVersion: payload.responseContractVersion ?? 3
			})
			chatState.invalidateGuestConversation(payload.conversationId)
			return { status: 'persisted', messageId: payload.clientMessageId }
		}

		return persistMessageWithOutbox(persistMessageToConversation, payload)
	}

	async function flushOutboxNow() {
		if (!isAuthenticated || isFlushingOutboxRef) return

		isFlushingOutboxRef = true

		try {
			const result = await flushMessagePersistenceOutbox(persistMessageToConversation)

			if (result.terminalFailures.length > 0) {
				const count = result.terminalFailures.length
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
	const chat = new Chat<ChatUIMessage>({
		id: 'ba-events-chat',
		transport: new DefaultChatTransport<ChatUIMessage>({
			api: '/api/chat',
			body: () => {
				const happeningSoonEventId = pendingHappeningSoonEventIdRef
				pendingHappeningSoonEventIdRef = null
				return {
					locale: getLocale() as 'en' | 'es',
					conversationId: conversationId ?? pendingConversationIdRef ?? null,
					userClientMessageId: pendingUserClientMessageIdRef,
					assistantClientMessageId: pendingAssistantClientMessageIdRef,
					...(happeningSoonEventId ? { happeningSoonEventId } : {})
				}
			}
		}),
		onFinish: async ({ message }) => {
			track('chat:response_received', {
				duration_ms: Date.now() - startTimeRef,
				events_returned: eventsCountRef
			})

			if (isHandoffRequestRef) {
				const handoffId = activeHandoffIdRef
				if (handoffId) {
					markHandoffPhase('complete')
					const elapsed = (end?: number, start?: number): number | null =>
						start !== undefined && end !== undefined
							? Math.round(Math.max(0, end - start))
							: null
					track('chat:first_message_handoff', {
						handoff_id: handoffId,
						query: pendingUserMessageRef ?? null,
						persistence_ms: elapsed(
							readHandoffMarkTime(handoffId, 'guest_conversation_written'),
							readHandoffMarkTime(handoffId, 'submit')
						),
						navigation_ms: elapsed(
							readHandoffMarkTime(handoffId, 'mount'),
							readHandoffMarkTime(handoffId, 'navigate')
						),
						consumption_ms: elapsed(
							readHandoffMarkTime(handoffId, 'consume'),
							readHandoffMarkTime(handoffId, 'mount')
						),
						request_start_ms: elapsed(
							readHandoffMarkTime(handoffId, 'request_start'),
							readHandoffMarkTime(handoffId, 'consume')
						),
						first_response_ms: elapsed(
							readHandoffMarkTime(handoffId, 'first_response'),
							readHandoffMarkTime(handoffId, 'request_start')
						),
						completion_ms: elapsed(
							readHandoffMarkTime(handoffId, 'complete'),
							readHandoffMarkTime(handoffId, 'request_start')
						),
						total_ms: elapsed(
							readHandoffMarkTime(handoffId, 'complete'),
							readHandoffMarkTime(handoffId, 'submit')
						)
					})
				}
				activeHandoffIdRef = null
				isHandoffRequestRef = false
				handoffMarksRef = {}
			}

			setRequestLifecyclePhase('persisting')

			const parts = message.parts as Array<{ type?: string; text?: string; data?: unknown }>
			const canonical = canonicalFromParts(parts)
			const textContent = canonical?.text?.trim() || extractVisibleTextFromUIMessageParts(parts)

			const resolvedConversationId = pendingConversationIdRef ?? conversationId ?? null
			if (resolvedConversationId) {
				if (pendingUserPersistencePromiseRef) {
					try {
						const userPersistResult = await pendingUserPersistencePromiseRef
						if (userPersistResult.messageId) {
							pendingUserPersistedMessageIdRef = userPersistResult.messageId
						}
					} catch (persistError) {
						console.error('Failed awaiting user persistence before assistant save:', persistError)
					}
				}

				const activeRequestId = activeRequestIdRef
				const executionTrace =
					executionTraceByAssistantIdRef.get(message.id) ??
					(activeRequestId
						? (pendingExecutionTraceByRequestIdRef.get(activeRequestId) ?? [])
						: [])
				const assistantClientMessageId = pendingAssistantClientMessageIdRef ?? generateId()

				const persistPayload: MessagePersistencePayload = {
					conversationId: resolvedConversationId,
					parentMessageId: pendingUserPersistedMessageIdRef,
					clientMessageId: assistantClientMessageId,
					role: 'assistant',
					content: textContent,
					visibleContent: textContent,
					executionTrace,
					responseContractVersion: 3,
					attachedData: canonical ? { canonical } : {}
				}

				try {
					const assistantPersistResult = await persistMessageResiliently(persistPayload)
					if (assistantPersistResult.messageId) {
						persistedAssistantMessageIdsRef.set(message.id, assistantPersistResult.messageId)
					}

					if (isFirstExchangeRef && pendingUserMessageRef) {
						isFirstExchangeRef = false
						void chatState.generateTitle({
							conversationId: resolvedConversationId,
							firstMessage: pendingUserMessageRef
						})
					}
				} catch (err) {
					console.error('Failed to persist assistant message:', err)
					setRequestLifecyclePhase('error')
					toast.error('Failed to save response', {
						description: 'Your conversation may not be saved properly',
						action: {
							label: 'Retry',
							onClick: () => persistMessageResiliently(persistPayload)
						}
					})
				}
			}

			if (activeRequestIdRef) {
				pendingExecutionTraceByRequestIdRef.delete(activeRequestIdRef)
			}
			executionTraceByAssistantIdRef.delete(message.id)

			pendingUserMessageRef = null
			pendingConversationIdRef = null
			pendingAssistantClientMessageIdRef = null
			pendingUserClientMessageIdRef = null
			pendingUserPersistencePromiseRef = null
			pendingUserPersistedMessageIdRef = null
			resetRequestCorrelations()

			if (requestPhaseRef !== 'error') {
				setRequestLifecyclePhase('idle')
			}
			void flushOutboxNow()
		},
		onError: (err) => {
			console.error('Chat error:', err)
			setRequestLifecyclePhase('error')
			error = err.message || 'An error occurred. Please try again.'
			track('chat:error', {
				error_type: 'client_error',
				error_message: err.message
			})
			pendingUserMessageRef = null
			pendingConversationIdRef = null
			pendingAssistantClientMessageIdRef = null
			pendingUserClientMessageIdRef = null
			pendingUserPersistencePromiseRef = null
			pendingUserPersistedMessageIdRef = null
			pendingFirstMessage = null
			activeHandoffIdRef = null
			isHandoffRequestRef = false
			handoffMarksRef = {}
			resetRequestCorrelations()
		},
		onData: (dataPart) => {
			if (dataPart.type === 'data-status') {
				const statusData = dataPart.data as {
					phase: ChatStreamStatusPhase
					requestId: string
					assistantMessageId?: string
				}
				activeRequestIdRef = statusData.requestId

				if (statusData.phase === 'finalizing' && !handoffMarksRef.first_response) {
					markHandoffPhase('first_response')
				}

				setRequestLifecyclePhase(mapStatusPhaseToRequestPhase(statusData.phase))
				return
			}

			if (dataPart.type === 'data-execution-trace') {
				const traceData = dataPart.data as {
					requestId: string
					assistantMessageId?: string
					steps: MessageExecutionStep[]
				}
				activeRequestIdRef = traceData.requestId
				if (traceData.assistantMessageId) {
					executionTraceByAssistantIdRef.set(traceData.assistantMessageId, traceData.steps)
				} else {
					pendingExecutionTraceByRequestIdRef.set(traceData.requestId, traceData.steps)
				}
			}
		}
	})

	// ==========================================================================
	// Send message
	// ==========================================================================
	async function handleSendMessage(content: string, options?: { eventId?: string }) {
		pendingHappeningSoonEventIdRef = options?.eventId ?? null
		error = null
		resetRequestCorrelations()
		eventsCountRef = 0
		startTimeRef = Date.now()
		track('chat:message_sent', {
			query: content,
			message_length: content.length,
			has_history: chat.messages.length > 0
		})

		const handoffId = !conversationId ? generateId() : null
		if (handoffId) {
			markHandoffPhase('submit', handoffId)
		}

		pendingUserMessageRef = content
		pendingUserPersistedMessageIdRef = null
		const userClientMessageId = generateId()
		const assistantClientMessageId = generateId()
		pendingUserClientMessageIdRef = userClientMessageId
		pendingAssistantClientMessageIdRef = assistantClientMessageId

		try {
			let currentConversationId = conversationId
			if (!currentConversationId) {
				if (!handoffId) {
					throw new Error('[chat] invariant: first-message branch without handoff id')
				}
				if (isAuthenticated) {
					const newConversation = await chatState.createConversation()
					currentConversationId = newConversation.id
				} else {
					currentConversationId = generateId()
					createGuestConversation(currentConversationId)
						.then(() => markHandoffPhase('guest_conversation_written', handoffId))
						.catch((persistError) => {
							console.error(
								'[chat] Failed to persist guest conversation to IndexedDB:',
								persistError
							)
						})

					const nowIso = new Date().toISOString()
					chatState.seedGuestConversation(currentConversationId, {
						conversation: {
							id: currentConversationId,
							title: null,
							created_at: nowIso,
							updated_at: nowIso
						},
						messages: []
					})
				}
				isHandoffPending = true
				markHandoffPhase('navigate', handoffId)
				chatState.setPendingFirstMessage({ content, eventId: options?.eventId, handoffId })
				onConversationChange?.(currentConversationId)
				return
			}

			setRequestLifecyclePhase('preparing')
			pendingConversationIdRef = currentConversationId

			const userMessagePayload: MessagePersistencePayload = {
				conversationId: currentConversationId,
				parentMessageId: null,
				clientMessageId: userClientMessageId,
				role: 'user',
				content,
				visibleContent: content,
				responseContractVersion: 3
			}

			const userPersistencePromise = persistMessageResiliently(userMessagePayload)
				.then((result) => {
					if (result.messageId) {
						pendingUserPersistedMessageIdRef = result.messageId
					}
					markHandoffPhase('user_persisted')
					return result
				})
				.catch((persistError) => {
					console.error('Failed to persist user message:', persistError)
					return { status: 'queued' } as MessagePersistenceResult
				})

			pendingUserPersistencePromiseRef = userPersistencePromise

			// Server-side assistant persistence resolves the parent by
			// userClientMessageId — ensure the user message is persisted first.
			if (isAuthenticated) {
				await userPersistencePromise
			}

			markHandoffPhase('request_start')
			await chat.sendMessage({
				text: content,
				metadata: { createdAt: new Date().toISOString() }
			})
			await userPersistencePromise
		} catch (err) {
			console.error('Failed to send message:', err)
			const errorMessage = err instanceof Error ? err.message : 'Failed to send message'
			setRequestLifecyclePhase('error')
			error = errorMessage
			toast.error('Failed to send message', {
				description: errorMessage,
				action: {
					label: 'Retry',
					onClick: () => handleSendMessage(content)
				}
			})
			pendingUserMessageRef = null
			pendingConversationIdRef = null
			pendingAssistantClientMessageIdRef = null
			pendingUserClientMessageIdRef = null
			pendingUserPersistencePromiseRef = null
			pendingUserPersistedMessageIdRef = null
			persistedAssistantMessageIdsRef.clear()
			pendingFirstMessage = null
			activeHandoffIdRef = null
			isHandoffRequestRef = false
			handoffMarksRef = {}
			resetRequestCorrelations()
		}
	}

	// ==========================================================================
	// Effects
	// ==========================================================================
	$effect(() => {
		chatState.setActiveConversationId(conversationId ?? null)
	})

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

		isLoadingGuestConversation = true
		let cancelled = false
		chatState.getGuestConversation(id).then((result) => {
			if (cancelled) return
			guestConversation = result
			isLoadingGuestConversation = false
		})

		return () => {
			cancelled = true
		}
	})

	$effect(() => {
		const prev = prevConversationIdRef
		prevConversationIdRef = conversationId

		const idle = requestPhaseRef === 'idle' || requestPhaseRef === 'error'
		if (!idle) return

		if (!conversationId || conversationId !== prev) {
			chat.messages = []
			messageTimestampsById.clear()
			executionTraceByAssistantIdRef.clear()
			persistedAssistantMessageIdsRef.clear()
			isFirstExchangeRef = true
		}

		if (!conversationId) return

		const isLoadingTarget = isAuthenticated ? false : isLoadingGuestConversation
		if (isLoadingTarget) return

		const sourceMessages = isAuthenticated
			? preloadedConversation?.messages
			: guestConversation?.messages
		if (!sourceMessages || sourceMessages.length === 0) return

		const sortedMessages = isAuthenticated
			? sortMessagesByTurnOrderAsc(sourceMessages as Message[])
			: [...sourceMessages].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))

		const uiMessages: ChatUIMessage[] = sortedMessages.map((storedMessage) => {
			const canonical =
				(storedMessage as Message).attached_data?.canonical ??
				adaptLegacyToCanonical(storedMessage as Message)
			const parts: Array<{ type: string; text?: string; data?: unknown }> = [
				{
					type: 'text',
					text: (storedMessage as Message).visible_content ?? storedMessage.content
				}
			]
			if (storedMessage.role === 'assistant') {
				parts.push({ type: 'data-response', data: canonical })
			}
			return {
				id: storedMessage.id,
				role: storedMessage.role as 'user' | 'assistant',
				metadata: { createdAt: storedMessage.created_at },
				parts
			} as ChatUIMessage
		})

		chat.messages = uiMessages

		const persistedAssistantIds = new Map<string, string>()
		for (const storedMessage of sortedMessages) {
			if (storedMessage.role === 'assistant') {
				persistedAssistantIds.set(storedMessage.id, storedMessage.id)
			}
		}
		persistedAssistantMessageIdsRef = persistedAssistantIds

		isFirstExchangeRef = sortedMessages.length > 0
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
		chatState.registerStartNewChatHandler(() => {
			void chat.stop()
			chat.messages = []
			messageTimestampsById.clear()
			executionTraceByAssistantIdRef.clear()
			setRequestLifecyclePhase('idle')
			error = null
			homeTimeContext = null
			pendingUserMessageRef = null
			pendingConversationIdRef = null
			pendingAssistantClientMessageIdRef = null
			pendingUserClientMessageIdRef = null
			pendingUserPersistencePromiseRef = null
			pendingUserPersistedMessageIdRef = null
			persistedAssistantMessageIdsRef.clear()
			activeHandoffIdRef = null
			isFirstExchangeRef = true
			resetRequestCorrelations()
		})
	})

	$effect(() => {
		if (!conversationId) return
		const pending = chatState.takePendingFirstMessage()
		if (pending) {
			activeHandoffIdRef = pending.handoffId
			markHandoffPhase('consume')
			isHandoffRequestRef = true
			untrack(() => {
				void handleSendMessage(pending.content, { eventId: pending.eventId })
			})
		}
	})

	$effect(() => {
		const optimistic = pendingFirstMessage
		if (!optimistic) return
		const landed = chat.messages.some(
			(message) =>
				message.role === 'user' &&
				extractVisibleTextFromUIMessageParts(
					message.parts as Array<{ type?: string; text?: string }>
				) === optimistic.content
		)
		if (landed) {
			pendingFirstMessage = null
		}
	})

	$effect(() => {
		if (!conversationId) {
			isHandoffPending = false
		}
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
			const canonical = message.role === 'assistant' ? canonicalFromParts(parts) : null
			const render = canonical
				? canonicalToRender(canonical)
				: { events: [], suggestions: [], directions: null, venue: null, operations: [] }
			if (canonical) {
				eventsCountRef = canonical.events.length
			}

			return {
				id: message.id,
				role: message.role as 'user' | 'assistant',
				content: textContent,
				timestamp: resolveMessageTimestamp(message, messageTimestampsById),
				isStreaming,
				events: render.events.length > 0 ? render.events : undefined,
				suggestions: render.suggestions.length > 0 ? render.suggestions : undefined,
				directions: render.directions ?? undefined,
				venue: render.venue ?? undefined,
				operations: render.operations.length > 0 ? render.operations : undefined
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

		if (!pendingFirstMessage) return visible
		const optimistic = pendingFirstMessage
		const alreadyRendered = chatMessages.some(
			(chatMessage) =>
				chatMessage.role === 'user' && chatMessage.content === optimistic.content
		)
		if (alreadyRendered) return visible

		return [
			{
				id: `pending-${optimistic.content}`,
				role: 'user' as const,
				content: optimistic.content,
				timestamp: new Date(),
				isStreaming: false
			},
			...visible
		]
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

	const loadingLabel = $derived.by(() => {
		switch (requestPhase) {
			case 'preparing':
				return m.chat_status_preparing()
			case 'thinking':
				return m.chat_status_thinking()
			case 'running_tool':
				return m.chat_status_running_tool()
			case 'composing':
				return m.chat_status_composing()
			case 'persisting':
				return m.chat_status_persisting()
			case 'error':
				return m.chat_status_error()
			case 'idle':
			default:
				return m.chat_thinking()
		}
	})

	const hasPendingHandoff = $derived(!!pendingFirstMessage)

	const showConversationLoading = $derived(
		!!(
			conversationId &&
			!hasPendingHandoff &&
			(isAuthenticated ? false : isLoadingGuestConversation) &&
			requestPhase === 'idle' &&
			!hasMessages
		)
	)

	const conversationMissing = $derived(
		!!(
			conversationId &&
			!hasPendingHandoff &&
			!(isAuthenticated ? false : isLoadingGuestConversation) &&
			!(isAuthenticated ? !!preloadedConversation : !!guestConversation) &&
			requestPhase === 'idle' &&
			!hasMessages
		)
	)

	function dismissError() {
		error = null
		if (requestPhaseRef === 'error') {
			setRequestLifecyclePhase('idle')
		}
	}
</script>

<div class="relative h-full min-h-0 flex flex-col">
	{#if error}
		<div
			class="absolute top-4 left-4 right-4 z-50 max-w-3xl mx-auto p-3 bg-destructive/20 border border-destructive rounded-lg text-sm flex items-center justify-between animate-fade-in-up"
		>
			<span>{error}</span>
			<button
				type="button"
				onclick={dismissError}
				class="ml-2 text-lg leading-none hover:opacity-70"
				aria-label="Dismiss error"
			>
				×
			</button>
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
					onclick={() => chatState.setActiveConversationId(null)}
				>
					{m.chat_start_new_chat()}
				</a>
			</div>
		{:else if hasMessages || requestPhase !== 'idle' || hasPendingHandoff}
			<MessageList
				messages={displayMessages}
				isLoading={showLoading}
				loadingPhase={requestPhase}
				loadingLabel={loadingLabel}
				onSuggestionSelect={handleSendMessage}
			/>
		{:else}
			<SuggestedPrompts
				onSelectPrompt={handleSendMessage}
				happeningSoonEvents={happeningSoonEvents}
				timeContext={homeTimeContext}
				onTimeContextChange={(context) => (homeTimeContext = context)}
			/>
		{/if}
	</div>

	<div class="shrink-0 bg-background">
		<ChatInput
			onSend={handleSendMessage}
			disabled={isLoading || showConversationLoading || isHandoffPending || hasPendingHandoff}
			emphasized={!hasMessages && requestPhase === 'idle' && !conversationId}
		/>
	</div>
</div>

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
	import MessageList from './MessageList.svelte'
	import ChatInput from './ChatInput.svelte'
	import SuggestedPrompts, { type HomeTimeContext } from './SuggestedPrompts.svelte'
	import type {
		ChatEventPayload,
		ChatMessage,
		ChatStreamDataEnvelope,
		ChatStreamStatusData,
		ChatStreamStatusPhase,
		ConversationWithMessages,
		DirectionsData,
		EventWithVenue,
		Message,
		MessageAttachedData,
		MessageExecutionStep,
		RefinementSuggestion
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
		trendingEvents = undefined as ChatEventPayload[] | undefined,
		preloadedConversation = null as ConversationWithMessages | null
	}: {
		conversationId?: string | null
		onConversationChange?: (id: string) => void
		trendingEvents?: ChatEventPayload[]
		preloadedConversation?: ConversationWithMessages | null
	} = $props()

	const auth = useAuthContext()
	const isAuthenticated = $derived(!!auth.user)

	// ==========================================================================
	// Rendered state (legacy React useState → Svelte $state)
	// ==========================================================================
	let error = $state<string | null>(null)
	let homeTimeContext = $state<HomeTimeContext>(null)
	let messageAttachedDataMap = $state<Map<string, MessageAttachedData>>(new Map())
	let pendingFirstMessage = $state<PendingFirstMessage | null>(null)
	let isHandoffPending = $state(false)
	let requestPhase = $state<RequestPhase>('idle')
	let guestConversation = $state<GuestConversationWithMessages | null>(null)
	let isLoadingGuestConversation = $state(false)
	let scrollContainerRef = $state<HTMLDivElement | null>(null)

	// ==========================================================================
	// Non-rendered refs (legacy useRef → plain let)
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
	let requestToAssistantMessageIdRef = new Map<string, string>()
	let pendingAttachedDataByRequestIdRef = new Map<string, MessageAttachedData>()
	let pendingExecutionTraceByRequestIdRef = new Map<string, MessageExecutionStep[]>()
	let executionTraceByAssistantIdRef = new Map<string, MessageExecutionStep[]>()
	let prevConversationIdRef: string | null | undefined = untrack(() => conversationId)

	let pendingTrendingEventIdRef: string | null = null
	let pendingUserMessageRef: string | null = null
	let pendingConversationIdRef: string | null = null
	let pendingAssistantClientMessageIdRef: string | null = null
	let pendingUserPersistencePromiseRef: Promise<MessagePersistenceResult> | null = null
	let pendingUserPersistedMessageIdRef: string | null = null
	let persistedAssistantMessageIdsRef = new Map<string, string>()
	let isFirstExchangeRef = true
	let isFlushingOutboxRef = false
	let restoredScrollConversationIdRef: string | null = null

	// ==========================================================================
	// Pure helpers (ported verbatim)
	// ==========================================================================
	function mapStatusPhaseToRequestPhase(phase: ChatStreamStatusPhase): RequestPhase {
		switch (phase) {
			case 'thinking':
				return 'thinking'
			case 'calling_tool':
				return 'running_tool'
			case 'composing':
				return 'composing'
			case 'done':
				return 'persisting'
			case 'error':
				return 'error'
			default:
				return 'thinking'
		}
	}

	type AssistantVisibilityMessage = Pick<ChatMessage, 'content' | 'events' | 'directions'>

	function assistantMessageHasVisibleContent(
		message: AssistantVisibilityMessage | null | undefined
	): boolean {
		if (!message) return false
		return !!(
			message.content.trim().length > 0 ||
			(message.events && message.events.length > 0) ||
			message.directions
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

	function isDataEnvelope<T>(value: unknown): value is ChatStreamDataEnvelope<T> {
		if (!value || typeof value !== 'object') return false
		const candidate = value as { requestId?: unknown; data?: unknown }
		return typeof candidate.requestId === 'string' && 'data' in candidate
	}

	// ==========================================================================
	// Request lifecycle / correlations
	// ==========================================================================
	function setRequestLifecyclePhase(phase: RequestPhase) {
		requestPhaseRef = phase
		requestPhase = phase
	}

	function setAttachedDataMap(next: Map<string, MessageAttachedData>) {
		messageAttachedDataMap = next
	}

	function upsertAttachedDataForAssistantMessage(
		assistantMessageId: string,
		updater: (current: MessageAttachedData) => MessageAttachedData
	) {
		const next = new Map(messageAttachedDataMap)
		const current = next.get(assistantMessageId) ?? {}
		next.set(assistantMessageId, updater(current))
		setAttachedDataMap(next)
	}

	function resetRequestCorrelations() {
		activeRequestIdRef = null
		requestToAssistantMessageIdRef.clear()
		pendingAttachedDataByRequestIdRef.clear()
		pendingExecutionTraceByRequestIdRef.clear()
	}

	function mergePendingDataIntoAssistantMessage(requestId: string, assistantMessageId: string) {
		const pendingData = pendingAttachedDataByRequestIdRef.get(requestId)
		if (pendingData) {
			upsertAttachedDataForAssistantMessage(assistantMessageId, (current) => ({
				...current,
				...pendingData
			}))
			pendingAttachedDataByRequestIdRef.delete(requestId)
		}

		const pendingTrace = pendingExecutionTraceByRequestIdRef.get(requestId)
		if (pendingTrace) {
			executionTraceByAssistantIdRef.set(assistantMessageId, pendingTrace)
			pendingExecutionTraceByRequestIdRef.delete(requestId)
		}
	}

	function applyAttachedDataFromEnvelope<T>(
		envelope: ChatStreamDataEnvelope<T>,
		update: (current: MessageAttachedData, value: T) => MessageAttachedData
	) {
		activeRequestIdRef = envelope.requestId

		if (envelope.assistantMessageId) {
			requestToAssistantMessageIdRef.set(envelope.requestId, envelope.assistantMessageId)
			mergePendingDataIntoAssistantMessage(envelope.requestId, envelope.assistantMessageId)
		}

		const resolvedAssistantMessageId =
			envelope.assistantMessageId ??
			requestToAssistantMessageIdRef.get(envelope.requestId) ??
			null

		if (resolvedAssistantMessageId) {
			upsertAttachedDataForAssistantMessage(resolvedAssistantMessageId, (current) =>
				update(current, envelope.data)
			)
			return
		}

		const pendingCurrent = pendingAttachedDataByRequestIdRef.get(envelope.requestId) ?? {}
		pendingAttachedDataByRequestIdRef.set(envelope.requestId, update(pendingCurrent, envelope.data))
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
	// Persistence (absorbed from the legacy useConversations hooks)
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
			responseContractVersion: payload.responseContractVersion ?? 2,
			attachedData: payload.attachedData
		})

		return typeof savedMessage?.id === 'string' ? { id: savedMessage.id } : undefined
	}

	async function persistMessageResiliently(
		payload: MessagePersistencePayload
	): Promise<MessagePersistenceResult> {
		if (!isAuthenticated) {
			// Guests have no server record; persist to the local IndexedDB store so
			// the conversation survives reload on the same browser.
			await addGuestMessage(payload.conversationId, {
				id: payload.clientMessageId,
				clientMessageId: payload.clientMessageId,
				parentMessageId: payload.parentMessageId,
				role: payload.role,
				content: payload.content,
				visibleContent: payload.visibleContent ?? payload.content,
				executionTrace: payload.executionTrace,
				attachedData: payload.attachedData
			})
			// Drop the synchronous seed so a future mount reads the persisted
			// conversation (with this message) from IndexedDB.
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
	// Streaming client. `@ai-sdk/svelte`'s Chat class consumes the same AI SDK
	// UI message stream protocol the legacy React chat hook used (including the
	// `data-*` envelopes from /api/chat), so no hand-rolled fetch reader is
	// needed — see the U1 evidence for the proof.
	// ==========================================================================
	const chat = new Chat<ChatUIMessage>({
		id: 'ba-events-chat',
		transport: new DefaultChatTransport<ChatUIMessage>({
			api: '/api/chat',
			body: () => {
				const trendingEventId = pendingTrendingEventIdRef
				pendingTrendingEventIdRef = null
				return {
					locale: getLocale() as 'en' | 'es',
					conversationId: conversationId ?? pendingConversationIdRef ?? null,
					...(trendingEventId ? { trendingEventId } : {})
				}
			}
		}),
		onFinish: async ({ message }) => {
			track('chat:response_received', {
				duration_ms: Date.now() - startTimeRef,
				events_returned: eventsCountRef
			})

			// First-message handoff phase breakdown (home submit → /chat/:id remount
			// → stream). Fired once, in the instance that actually streamed. All
			// marks are read by handoff id: a phase the CURRENT handoff never
			// marked stays undefined and cannot borrow an earlier handoff's entry.
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

			const activeRequestId = activeRequestIdRef
			if (activeRequestId) {
				requestToAssistantMessageIdRef.set(activeRequestId, message.id)
				mergePendingDataIntoAssistantMessage(activeRequestId, message.id)
			}

			const resolvedConversationId = pendingConversationIdRef ?? conversationId ?? null
			if (resolvedConversationId) {
				const textContent = extractVisibleTextFromUIMessageParts(
					message.parts as Array<{ type?: string; text?: string }>
				)

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

				const attachedData = messageAttachedDataMap.get(message.id)
				const executionTrace =
					executionTraceByAssistantIdRef.get(message.id) ??
					(activeRequestId
						? (pendingExecutionTraceByRequestIdRef.get(activeRequestId) ?? [])
						: [])
				const assistantClientMessageId = pendingAssistantClientMessageIdRef ?? generateId()

				try {
					const assistantPersistResult = await persistMessageResiliently({
						conversationId: resolvedConversationId,
						parentMessageId: pendingUserPersistedMessageIdRef,
						clientMessageId: assistantClientMessageId,
						role: 'assistant',
						content: textContent,
						visibleContent: textContent,
						executionTrace,
						responseContractVersion: 2,
						attachedData
					})
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
							onClick: () =>
								persistMessageResiliently({
									conversationId: resolvedConversationId,
									parentMessageId: pendingUserPersistedMessageIdRef,
									clientMessageId: assistantClientMessageId,
									role: 'assistant',
									content: textContent,
									visibleContent: textContent,
									executionTrace,
									responseContractVersion: 2,
									attachedData
								})
						}
					})
				}
			}

			if (activeRequestId) {
				pendingExecutionTraceByRequestIdRef.delete(activeRequestId)
			}
			executionTraceByAssistantIdRef.delete(message.id)

			pendingUserMessageRef = null
			pendingConversationIdRef = null
			pendingAssistantClientMessageIdRef = null
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
			pendingUserPersistencePromiseRef = null
			pendingUserPersistedMessageIdRef = null
			// A failed handoff stream never appends the real user message — clear
			// the optimistic copy so the composer unlocks.
			pendingFirstMessage = null
			activeHandoffIdRef = null
			isHandoffRequestRef = false
			handoffMarksRef = {}
			resetRequestCorrelations()
		},
		onData: (dataPart) => {
			if (dataPart.type === 'data-status') {
				const statusData = dataPart.data as ChatStreamStatusData
				activeRequestIdRef = statusData.requestId

				if (statusData.assistantMessageId) {
					requestToAssistantMessageIdRef.set(statusData.requestId, statusData.assistantMessageId)
					mergePendingDataIntoAssistantMessage(
						statusData.requestId,
						statusData.assistantMessageId
					)
				}

				// The server emits 'composing' right before writing the response
				// text — the earliest reliable "first response" signal.
				if (statusData.phase === 'composing' && !handoffMarksRef.first_response) {
					markHandoffPhase('first_response')
				}

				setRequestLifecyclePhase(mapStatusPhaseToRequestPhase(statusData.phase))
				return
			}

			if (dataPart.type === 'data-events') {
				if (isDataEnvelope<EventWithVenue[]>(dataPart.data)) {
					applyAttachedDataFromEnvelope(dataPart.data, (current, eventsData) => {
						eventsCountRef = eventsData.length
						if (eventsData.length === 0) {
							track('chat:no_results', {})
						}
						return {
							...current,
							events: eventsData.length > 0 ? eventsData : undefined
						}
					})
				}
				return
			}

			if (dataPart.type === 'data-suggestions') {
				if (isDataEnvelope<RefinementSuggestion[]>(dataPart.data)) {
					applyAttachedDataFromEnvelope(dataPart.data, (current, suggestionsData) => ({
						...current,
						suggestions: suggestionsData.length > 0 ? suggestionsData : undefined
					}))
				}
				return
			}

			if (dataPart.type === 'data-directions') {
				if (isDataEnvelope<DirectionsData>(dataPart.data)) {
					applyAttachedDataFromEnvelope(dataPart.data, (current, directionsData) => ({
						...current,
						directions: directionsData
					}))
				}
				return
			}

			if (dataPart.type === 'data-execution-trace') {
				if (isDataEnvelope<MessageExecutionStep[]>(dataPart.data)) {
					const envelope = dataPart.data
					activeRequestIdRef = envelope.requestId

					if (envelope.assistantMessageId) {
						requestToAssistantMessageIdRef.set(envelope.requestId, envelope.assistantMessageId)
						executionTraceByAssistantIdRef.set(envelope.assistantMessageId, envelope.data)
					} else {
						pendingExecutionTraceByRequestIdRef.set(envelope.requestId, envelope.data)
					}
				}
			}
		}
	})

	// ==========================================================================
	// Send message (ports the legacy handleSendMessage useCallback)
	// ==========================================================================
	async function handleSendMessage(content: string, options?: { eventId?: string }) {
		pendingTrendingEventIdRef = options?.eventId ?? null
		error = null
		resetRequestCorrelations()
		eventsCountRef = 0

		startTimeRef = Date.now()
		track('chat:message_sent', {
			query: content,
			message_length: content.length,
			has_history: chat.messages.length > 0
		})

		// No active conversation means this will be a first-message handoff:
		// mint the unique id NOW so the submit mark and the parked message
		// share it (the id travels through the remount).
		const handoffId = !conversationId ? generateId() : null
		if (handoffId) {
			markHandoffPhase('submit', handoffId)
		}

		pendingUserMessageRef = content
		pendingUserPersistedMessageIdRef = null
		const userClientMessageId = generateId()
		const assistantClientMessageId = generateId()
		pendingAssistantClientMessageIdRef = assistantClientMessageId

		try {
			// Resolve an active conversation: reuse the URL id, or create one.
			let currentConversationId = conversationId
			if (!currentConversationId) {
				// Invariant: this branch is only reachable when conversationId was
				// null, which is exactly when handoffId was minted at the top.
				if (!handoffId) {
					throw new Error('[chat] invariant: first-message branch without handoff id')
				}
				if (isAuthenticated) {
					const newConversation = await chatState.createConversation()
					currentConversationId = newConversation.id
				} else {
					currentConversationId = generateId()
					// Persist the guest conversation WITHOUT blocking the navigation:
					// fire-and-forget IndexedDB write (safe-failure), plus a
					// synchronous seed so the remounted /chat/:id instance resolves
					// the conversation instantly.
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
				// First message of a new conversation: navigating to /chat/{id}
				// remounts this component, so sending here would stream the response
				// into an unmounted instance. Park the message in the ChatState and
				// let the instance that mounts at /chat/{id} send it.
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
				responseContractVersion: 2
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
			pendingUserPersistencePromiseRef = null
			pendingUserPersistedMessageIdRef = null
			persistedAssistantMessageIdsRef.clear()
			// A failed send never appends the user message, so the optimistic
			// handoff copy would otherwise lock the composer forever.
			pendingFirstMessage = null
			activeHandoffIdRef = null
			isHandoffRequestRef = false
			handoffMarksRef = {}
			resetRequestCorrelations()
		}
	}

	// ==========================================================================
	// Effects (legacy useEffect → $effect)
	// ==========================================================================
	// Keep the active conversation id in the shared state (sidebar highlight).
	$effect(() => {
		chatState.setActiveConversationId(conversationId ?? null)
	})

	// Load the guest conversation from IndexedDB when the URL changes. Signed-in
	// conversations arrive preloaded from the route's +page.server.ts load.
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

	// Load conversation messages into the chat timeline when the URL id changes.
	// Never overwrite the in-flight timeline while a request is active.
	$effect(() => {
		const prev = prevConversationIdRef
		prevConversationIdRef = conversationId

		const idle = requestPhaseRef === 'idle' || requestPhaseRef === 'error'
		if (!idle) return

		// No active conversation, or a deliberate navigation to a different one:
		// start from a blank timeline.
		if (!conversationId || conversationId !== prev) {
			chat.messages = []
			setAttachedDataMap(new Map())
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

		const uiMessages: ChatUIMessage[] = sortedMessages.map((storedMessage) => ({
			id: storedMessage.id,
			role: storedMessage.role as 'user' | 'assistant',
			metadata: { createdAt: storedMessage.created_at },
			parts: [
				{
					type: 'text' as const,
					text: storedMessage.visible_content ?? storedMessage.content
				}
			]
		}))

		chat.messages = uiMessages

		const attachedDataMap = new Map<string, MessageAttachedData>()
		const persistedAssistantIds = new Map<string, string>()
		for (const storedMessage of sortedMessages) {
			if (storedMessage.role === 'assistant' && storedMessage.attached_data) {
				attachedDataMap.set(storedMessage.id, storedMessage.attached_data)
			}
			if (storedMessage.role === 'assistant') {
				persistedAssistantIds.set(storedMessage.id, storedMessage.id)
			}
		}
		setAttachedDataMap(attachedDataMap)
		persistedAssistantMessageIdsRef = persistedAssistantIds

		isFirstExchangeRef = sortedMessages.length > 0
	})

	// Flush any pending persistence retries on load.
	$effect(() => {
		void flushOutboxNow()
	})

	// Flush retries as soon as connectivity is restored.
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

	// Register the startNewChat handler (called from the sidebar via ChatState).
	$effect(() => {
		chatState.registerStartNewChatHandler(() => {
			void chat.stop()
			chat.messages = []
			setAttachedDataMap(new Map())
			messageTimestampsById.clear()
			executionTraceByAssistantIdRef.clear()
			setRequestLifecyclePhase('idle')
			error = null
			homeTimeContext = null
			pendingUserMessageRef = null
			pendingConversationIdRef = null
			pendingAssistantClientMessageIdRef = null
			pendingUserPersistencePromiseRef = null
			pendingUserPersistedMessageIdRef = null
			persistedAssistantMessageIdsRef.clear()
			activeHandoffIdRef = null
			isFirstExchangeRef = true
			resetRequestCorrelations()
		})
	})

	// Consume a first-message handoff from the home screen. One-shot:
	// takePendingFirstMessage clears on read, so re-runs are no-ops.
	$effect(() => {
		// Only consume the handoff once a conversation id is present.
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

	// Drop the optimistic first-message copy once sendMessage has appended the
	// real user message (same content), and re-enable the composer.
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

	// Returning to the home screen (conversationId cleared) re-arms a composer
	// that was locked while a handoff was in flight on this instance.
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

	// Restore a remembered scroll position for this conversation.
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
			const textContent = extractVisibleTextFromUIMessageParts(
				message.parts as Array<{ type?: string; text?: string }>
			)

			const isLastAssistant =
				message.role === 'assistant' && index === chat.messages.length - 1
			const isStreaming = isLastAssistant && chat.status === 'streaming'

			const storedData =
				message.role === 'assistant' ? messageAttachedDataMap.get(message.id) : undefined

			return {
				id: message.id,
				role: message.role as 'user' | 'assistant',
				content: textContent,
				timestamp: resolveMessageTimestamp(message, messageTimestampsById),
				isStreaming,
				events: storedData?.events,
				suggestions: storedData?.suggestions,
				directions: storedData?.directions
			} satisfies ChatMessage
		})
	})

	const displayMessages = $derived.by(() => {
		const visible = chatMessages.filter((chatMessage) => {
			if (chatMessage.role === 'user') return true
			const hasVisibleContent =
				chatMessage.content.trim().length > 0 ||
				(chatMessage.events && chatMessage.events.length > 0) ||
				chatMessage.directions
			return hasVisibleContent || chatMessage.isStreaming
		})

		// Optimistic copy of the parked first message, rendered from the very
		// first frame of the remounted instance.
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
				<p class="text-muted-foreground">{m.chat_conversation_not_found()}</p>
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
				trendingEvents={trendingEvents}
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

import { useState, useCallback, useRef, useEffect, useMemo, type UIEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { useChat, type UIMessage } from '@ai-sdk/react'
import { DefaultChatTransport, generateId } from 'ai'
import type {
  ChatStreamDataEnvelope,
  ChatStreamStatusData,
  ChatStreamStatusPhase,
  ChatMessage,
  EventWithVenue,
  RefinementSuggestion,
  DirectionsData,
  MessageExecutionStep,
  Message,
  MessageAttachedData,
  ChatEventPayload,
} from '@/shared/lib/types'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { SuggestedPrompts, type HomeTimeContext } from './SuggestedPrompts'
import { getLocale } from '@/paraglide/runtime'
import * as m from '@/paraglide/messages'
import { queryKeys } from '@/shared/lib/query'
import { track } from '@/lib/analytics'
import { usePullToRefresh } from '@/shared/hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '@/shared/ui/PullToRefreshIndicator'
import {
  useChatContext,
  type PendingFirstMessage,
} from '@/shared/providers/ChatProvider'
import {
  useConversation,
  useGuestConversation,
  useCreateConversation,
  useAddMessage,
  useGenerateTitle,
} from '@/features/chat/hooks/useConversations'
import { extractVisibleTextFromUIMessageParts } from '@/features/chat/lib/extract-visible-text'
import {
  flushMessagePersistenceOutbox,
  persistMessageWithOutbox,
  type MessagePersistencePayload,
  type MessagePersistenceResult,
} from '@/features/chat/lib/persistence-outbox'
import {
  addGuestMessage,
  createGuestConversation,
} from '@/shared/lib/db/guest-conversations'
import { useAuthContext } from '@/features/auth/hooks/useAuthContext'
import { sortMessagesByTurnOrderAsc } from '@/features/chat/lib/message-order'
import { resolveMessageTimestamp } from '@/features/chat/lib/message-timestamps'
import {
  markHandoffPhaseTime,
  readHandoffMarkTime,
  type HandoffPhase,
} from '@/features/chat/lib/handoff-marks'

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
  requestPhase: RequestPhase
): boolean {
  const hasVisibleAssistantContent = assistantMessageHasVisibleContent(lastAssistantMessage)
  if (hasVisibleAssistantContent) return false
  if (requestPhase === 'error') return false
  if (requestPhase !== 'idle') return true
  return status === 'submitted' || status === 'streaming'
}

function isDataEnvelope<T>(value: unknown): value is ChatStreamDataEnvelope<T> {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { requestId?: unknown; data?: unknown }
  return typeof candidate.requestId === 'string' && 'data' in candidate
}

export interface ChatContainerProps {
  /** Active conversation id, driven by the `/chat/:conversationId` URL. */
  conversationId?: string | null
  /** Called when a new conversation is created so the caller can update the URL. */
  onConversationChange?: (id: string) => void
  /** Prefetched trending events (route loader), passed to the home grid. */
  trendingEvents?: ChatEventPayload[]
}

export function ChatContainer({
  conversationId,
  onConversationChange,
  trendingEvents,
}: ChatContainerProps = {}) {
  const [error, setError] = useState<string | null>(null)
  const [homeTimeContext, setHomeTimeContext] = useState<HomeTimeContext>(null)
  const [messageAttachedDataMap, setMessageAttachedDataMap] = useState<
    Map<string, MessageAttachedData>
  >(new Map())
  const messageAttachedDataMapRef = useRef<Map<string, MessageAttachedData>>(new Map())
  const messageTimestampsByIdRef = useRef<Map<string, Date>>(new Map())

  const startTimeRef = useRef<number>(0)
  const eventsCountRef = useRef<number>(0)

  // ==========================================================================
  // First-message handoff performance instrumentation
  //
  // Phases (all wall-clock `performance.now()` offsets):
  //   submit                  user pressed send on the home screen
  //   navigate                conversation created, navigation to /chat/:id started
  //   mount                   the remounted /chat/:id instance rendered
  //   consume                 parked message picked up by the mounted instance
  //   request_start           sendMessage invoked (stream request sent)
  //   first_response          server reported the response is composing
  //   complete                onFinish fired
  //   guest_conversation_written  fire-and-forget IndexedDB write resolved
  //   user_persisted          user message IndexedDB/server write resolved
  //
  // Every mark is scoped by a unique handoff id (PendingFirstMessage.handoffId,
  // generated by the submitting instance and carried across the remount):
  // `chat:handoff:<handoffId>:<phase>`. A phase that was never marked for a
  // given handoff reads back as undefined — it can never borrow an earlier
  // handoff's timeline entry, because the names are disjoint per id.
  // ==========================================================================
  type HandoffMarks = Partial<Record<HandoffPhase, number>>

  const handoffMarksRef = useRef<HandoffMarks>({})
  // The id of the handoff THIS instance is streaming, set when the parked
  // message is consumed (null for regular sends and on the home instance).
  const activeHandoffIdRef = useRef<string | null>(null)
  // True only for the request that consumes a parked first message, so the
  // phase breakdown is tracked exactly once, in the instance that streams.
  const isHandoffRequestRef = useRef(false)

  const markHandoffPhase = useCallback((phase: HandoffPhase, handoffId?: string) => {
    const id = handoffId ?? activeHandoffIdRef.current
    if (!id) return
    const time = markHandoffPhaseTime(id, phase)
    if (time !== null) {
      handoffMarksRef.current[phase] = time
    }
  }, [])

  // Conversation context (the active id is kept in sync with the URL below)
  const {
    setActiveConversationId,
    registerStartNewChatHandler,
    setPendingFirstMessage,
    peekPendingFirstMessage,
    takePendingFirstMessage,
    saveConversationScrollPosition,
    getConversationScrollPosition,
  } = useChatContext()
  const { user } = useAuthContext()
  const isAuthenticated = !!user
  const queryClient = useQueryClient()

  // Optimistic copy of the parked first message. Initialized once from the
  // provider (non-destructive peek) so the remounted instance renders the
  // submitted message on the very first frame — before the one-shot take in
  // the handoff effect consumes it and sendMessage appends the real message.
  const [pendingFirstMessage, setPendingFirstMessageState] =
    useState<PendingFirstMessage | null>(() => {
      const pending = conversationId ? peekPendingFirstMessage() : null
      if (pending) {
        markHandoffPhase('mount', pending.handoffId)
      }
      return pending
    })
  // Set on the submitting (home) instance so its composer locks while the
  // handoff is in flight; the remounted instance locks via pendingFirstMessage.
  const [isHandoffPending, setIsHandoffPending] = useState(false)

  // Normalized id for hooks and loaders (the URL param is undefined on /chat).
  const activeConversationId = conversationId ?? null

  // The conversation id comes from the `/chat/:conversationId` URL. Keep it
  // in sync with the context so sidebar highlighting and helpers stay correct.
  useEffect(() => {
    setActiveConversationId(activeConversationId)
  }, [activeConversationId, setActiveConversationId])

  const { data: loadedConversation, isLoading: isLoadingConversation } =
    useConversation(activeConversationId)
  const { data: guestConversation, isLoading: isLoadingGuestConversation } =
    useGuestConversation(isAuthenticated ? null : activeConversationId)
  const createConversation = useCreateConversation()
  const addMessage = useAddMessage()
  const generateTitle = useGenerateTitle()
  const [requestPhase, setRequestPhase] = useState<RequestPhase>('idle')
  const requestPhaseRef = useRef<RequestPhase>('idle')

  // Request correlation for message-scoped streamed attached data
  const activeRequestIdRef = useRef<string | null>(null)
  const requestToAssistantMessageIdRef = useRef<Map<string, string>>(new Map())
  const pendingAttachedDataByRequestIdRef = useRef<Map<string, MessageAttachedData>>(new Map())
  const pendingExecutionTraceByRequestIdRef = useRef<Map<string, MessageExecutionStep[]>>(new Map())
  const executionTraceByAssistantIdRef = useRef<Map<string, MessageExecutionStep[]>>(new Map())
  const prevConversationIdRef = useRef<string | null | undefined>(conversationId)

  const setRequestLifecyclePhase = useCallback((phase: RequestPhase) => {
    requestPhaseRef.current = phase
    setRequestPhase(phase)
  }, [])

  // One-shot pin for a home-screen trending event tap: carried in the request
  // body (not the message text), so the exact event id stays out of the chat UI.
  const pendingTrendingEventIdRef = useRef<string | null>(null)

  // Track message persistence state
  const pendingUserMessageRef = useRef<string | null>(null)
  const pendingConversationIdRef = useRef<string | null>(null)
  const pendingAssistantClientMessageIdRef = useRef<string | null>(null)
  const pendingUserPersistencePromiseRef = useRef<Promise<MessagePersistenceResult> | null>(null)
  const pendingUserPersistedMessageIdRef = useRef<string | null>(null)
  const persistedAssistantMessageIdsRef = useRef<Map<string, string>>(new Map())
  // Keep useChat instance stable while conversation ids change (first-send race).
  const chatSessionIdRef = useRef('ba-events-chat')
  // Track if this is the first exchange (for title generation)
  const isFirstExchangeRef = useRef(true)
  const isFlushingOutboxRef = useRef(false)
  const restoredScrollConversationIdRef = useRef<string | null>(null)

  const setAttachedDataMap = useCallback((next: Map<string, MessageAttachedData>) => {
    messageAttachedDataMapRef.current = next
    setMessageAttachedDataMap(next)
  }, [])

  const upsertAttachedDataForAssistantMessage = useCallback(
    (
      assistantMessageId: string,
      updater: (current: MessageAttachedData) => MessageAttachedData
    ) => {
      const next = new Map(messageAttachedDataMapRef.current)
      const current = next.get(assistantMessageId) ?? {}
      next.set(assistantMessageId, updater(current))
      setAttachedDataMap(next)
    },
    [setAttachedDataMap]
  )

  const resetRequestCorrelations = useCallback(() => {
    activeRequestIdRef.current = null
    requestToAssistantMessageIdRef.current.clear()
    pendingAttachedDataByRequestIdRef.current.clear()
    pendingExecutionTraceByRequestIdRef.current.clear()
  }, [])

  const mergePendingDataIntoAssistantMessage = useCallback(
    (requestId: string, assistantMessageId: string) => {
      const pendingData = pendingAttachedDataByRequestIdRef.current.get(requestId)
      if (pendingData) {
        upsertAttachedDataForAssistantMessage(assistantMessageId, (current) => ({
          ...current,
          ...pendingData,
        }))
        pendingAttachedDataByRequestIdRef.current.delete(requestId)
      }

      const pendingTrace = pendingExecutionTraceByRequestIdRef.current.get(requestId)
      if (pendingTrace) {
        executionTraceByAssistantIdRef.current.set(assistantMessageId, pendingTrace)
        pendingExecutionTraceByRequestIdRef.current.delete(requestId)
      }
    },
    [upsertAttachedDataForAssistantMessage]
  )

  const applyAttachedDataFromEnvelope = useCallback(
    <T,>(
      envelope: ChatStreamDataEnvelope<T>,
      update: (current: MessageAttachedData, value: T) => MessageAttachedData
    ) => {
      activeRequestIdRef.current = envelope.requestId

      if (envelope.assistantMessageId) {
        requestToAssistantMessageIdRef.current.set(
          envelope.requestId,
          envelope.assistantMessageId
        )
        mergePendingDataIntoAssistantMessage(envelope.requestId, envelope.assistantMessageId)
      }

      const resolvedAssistantMessageId =
        envelope.assistantMessageId ??
        requestToAssistantMessageIdRef.current.get(envelope.requestId) ??
        null

      if (resolvedAssistantMessageId) {
        upsertAttachedDataForAssistantMessage(resolvedAssistantMessageId, (current) =>
          update(current, envelope.data)
        )
        return
      }

      const pendingCurrent = pendingAttachedDataByRequestIdRef.current.get(envelope.requestId) ?? {}
      pendingAttachedDataByRequestIdRef.current.set(
        envelope.requestId,
        update(pendingCurrent, envelope.data)
      )
    },
    [mergePendingDataIntoAssistantMessage, upsertAttachedDataForAssistantMessage]
  )

  // Pull-to-refresh for mobile (uses direct DOM manipulation for 60fps)
  const { containerRef, indicatorRef } = usePullToRefresh({
    onRefresh: () => window.location.reload(),
  })

  const persistMessageToConversation = useCallback(
    async (payload: MessagePersistencePayload): Promise<{ id?: string } | void> => {
      const savedMessage = await addMessage.mutateAsync({
        conversationId: payload.conversationId,
        parentMessageId: payload.parentMessageId,
        role: payload.role,
        clientMessageId: payload.clientMessageId,
        content: payload.content,
        visibleContent: payload.visibleContent ?? payload.content,
        executionTrace: payload.executionTrace,
        responseContractVersion: payload.responseContractVersion ?? 2,
        attachedData: payload.attachedData,
      })

      return typeof savedMessage?.id === 'string' ? { id: savedMessage.id } : undefined
    },
    [addMessage]
  )

  const persistMessageResiliently = useCallback(
    async (payload: MessagePersistencePayload): Promise<MessagePersistenceResult> => {
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
          attachedData: payload.attachedData,
        })
        // Guests write to IndexedDB outside React Query, so the cached
        // guest-detail snapshot goes stale (it was fetched before this
        // message existed). Invalidate it so a remount — e.g. navigating to
        // an event detail page and back — refetches the full conversation
        // instead of showing only the earlier messages.
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.guestDetail(payload.conversationId),
        })
        return { status: 'persisted', messageId: payload.clientMessageId }
      }

      return persistMessageWithOutbox(persistMessageToConversation, payload)
    },
    [isAuthenticated, persistMessageToConversation, queryClient]
  )

  const flushOutboxNow = useCallback(async () => {
    if (!isAuthenticated || isFlushingOutboxRef.current) return

    isFlushingOutboxRef.current = true

    try {
      const result = await flushMessagePersistenceOutbox(persistMessageToConversation)

      if (result.terminalFailures.length > 0) {
        const count = result.terminalFailures.length
        toast.warning('Unable to sync some chat messages', {
          description:
            count === 1
              ? 'One message could not be saved after multiple retries.'
              : `${count} messages could not be saved after multiple retries.`,
        })
      }
    } catch (flushError) {
      console.error('[chat] Failed to flush persistence outbox:', flushError)
    } finally {
      isFlushingOutboxRef.current = false
    }
  }, [isAuthenticated, persistMessageToConversation])

  const {
    messages,
    sendMessage,
    status,
    setMessages,
    stop,
  } = useChat<ChatUIMessage>({
    id: chatSessionIdRef.current,
    transport: new DefaultChatTransport<ChatUIMessage>({
      api: '/api/chat',
      body: () => {
        const trendingEventId = pendingTrendingEventIdRef.current
        pendingTrendingEventIdRef.current = null
        return {
          locale: getLocale() as 'en' | 'es',
          ...(trendingEventId ? { trendingEventId } : {}),
        }
      },
    }),
    onFinish: async ({ message }) => {
      track('chat:response_received', {
        duration_ms: Date.now() - startTimeRef.current,
        events_returned: eventsCountRef.current,
      })

      // First-message handoff phase breakdown (home submit → /chat/:id remount
      // → stream). Fired once, in the instance that actually streamed. All
      // marks are read by handoff id: a phase the CURRENT handoff never
      // marked (e.g. the guest IndexedDB write failed) stays undefined and
      // cannot borrow an earlier handoff's timeline entry.
      if (isHandoffRequestRef.current) {
        const handoffId = activeHandoffIdRef.current
        if (handoffId) {
          markHandoffPhase('complete')
          const elapsed = (end?: number, start?: number): number | null =>
            start !== undefined && end !== undefined
              ? Math.round(Math.max(0, end - start))
              : null
          track('chat:first_message_handoff', {
            handoff_id: handoffId,
            query: pendingUserMessageRef.current ?? null,
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
            ),
          })
        }
        activeHandoffIdRef.current = null
        isHandoffRequestRef.current = false
        handoffMarksRef.current = {}
      }

      setRequestLifecyclePhase('persisting')

      const activeRequestId = activeRequestIdRef.current
      if (activeRequestId) {
        requestToAssistantMessageIdRef.current.set(activeRequestId, message.id)
        mergePendingDataIntoAssistantMessage(activeRequestId, message.id)
      }

      const resolvedConversationId =
        pendingConversationIdRef.current ?? conversationId ?? null
      if (resolvedConversationId) {
        const textContent = extractVisibleTextFromUIMessageParts(
          message.parts as Array<{ type?: string; text?: string }>
        )

        if (pendingUserPersistencePromiseRef.current) {
          try {
            const userPersistResult = await pendingUserPersistencePromiseRef.current
            if (userPersistResult.messageId) {
              pendingUserPersistedMessageIdRef.current = userPersistResult.messageId
            }
          } catch (persistError) {
            console.error('Failed awaiting user persistence before assistant save:', persistError)
          }
        }

        const attachedData = messageAttachedDataMapRef.current.get(message.id)
        const executionTrace =
          executionTraceByAssistantIdRef.current.get(message.id) ??
          (activeRequestId
            ? pendingExecutionTraceByRequestIdRef.current.get(activeRequestId) ?? []
            : [])
        const assistantClientMessageId =
          pendingAssistantClientMessageIdRef.current ?? generateId()

        try {
          const assistantPersistResult = await persistMessageResiliently({
            conversationId: resolvedConversationId,
            parentMessageId: pendingUserPersistedMessageIdRef.current,
            clientMessageId: assistantClientMessageId,
            role: 'assistant',
            content: textContent,
            visibleContent: textContent,
            executionTrace,
            responseContractVersion: 2,
            attachedData,
          })
          if (assistantPersistResult.messageId) {
            persistedAssistantMessageIdsRef.current.set(message.id, assistantPersistResult.messageId)
          }

          if (isFirstExchangeRef.current && pendingUserMessageRef.current) {
            isFirstExchangeRef.current = false
            generateTitle.mutate({
              conversationId: resolvedConversationId,
              firstMessage: pendingUserMessageRef.current,
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
                  parentMessageId: pendingUserPersistedMessageIdRef.current,
                  clientMessageId: assistantClientMessageId,
                  role: 'assistant',
                  content: textContent,
                  visibleContent: textContent,
                  executionTrace,
                  responseContractVersion: 2,
                  attachedData,
                }),
            },
          })
        }
      }

      if (activeRequestId) {
        pendingExecutionTraceByRequestIdRef.current.delete(activeRequestId)
      }
      executionTraceByAssistantIdRef.current.delete(message.id)

      pendingUserMessageRef.current = null
      pendingConversationIdRef.current = null
      pendingAssistantClientMessageIdRef.current = null
      pendingUserPersistencePromiseRef.current = null
      pendingUserPersistedMessageIdRef.current = null
      resetRequestCorrelations()

      if (requestPhaseRef.current !== 'error') {
        setRequestLifecyclePhase('idle')
      }
      void flushOutboxNow()
    },
    onError: (err) => {
      console.error('Chat error:', err)
      setRequestLifecyclePhase('error')
      setError(err.message || 'An error occurred. Please try again.')
      track('chat:error', {
        error_type: 'client_error',
        error_message: err.message,
      })
      pendingUserMessageRef.current = null
      pendingConversationIdRef.current = null
      pendingAssistantClientMessageIdRef.current = null
      pendingUserPersistencePromiseRef.current = null
      pendingUserPersistedMessageIdRef.current = null
      // A failed handoff stream never appends the real user message — clear
      // the optimistic copy so the composer unlocks.
      setPendingFirstMessageState(null)
      activeHandoffIdRef.current = null
      isHandoffRequestRef.current = false
      handoffMarksRef.current = {}
      resetRequestCorrelations()
    },
    onData: (dataPart) => {
      if (dataPart.type === 'data-status') {
        const statusData = dataPart.data as ChatStreamStatusData
        activeRequestIdRef.current = statusData.requestId

        if (statusData.assistantMessageId) {
          requestToAssistantMessageIdRef.current.set(
            statusData.requestId,
            statusData.assistantMessageId
          )
          mergePendingDataIntoAssistantMessage(
            statusData.requestId,
            statusData.assistantMessageId
          )
        }

        // The server emits 'composing' right before writing the response
        // text — the earliest reliable "first response" signal.
        if (statusData.phase === 'composing' && !handoffMarksRef.current.first_response) {
          markHandoffPhase('first_response')
        }

        setRequestLifecyclePhase(mapStatusPhaseToRequestPhase(statusData.phase))
        return
      }

      if (dataPart.type === 'data-events') {
        if (isDataEnvelope<EventWithVenue[]>(dataPart.data)) {
          applyAttachedDataFromEnvelope(dataPart.data, (current, eventsData) => {
            eventsCountRef.current = eventsData.length
            if (eventsData.length === 0) {
              track('chat:no_results', {})
            }

            return {
              ...current,
              events: eventsData.length > 0 ? eventsData : undefined,
            }
          })
        }
        return
      }

      if (dataPart.type === 'data-suggestions') {
        if (isDataEnvelope<RefinementSuggestion[]>(dataPart.data)) {
          applyAttachedDataFromEnvelope(dataPart.data, (current, suggestionsData) => ({
            ...current,
            suggestions: suggestionsData.length > 0 ? suggestionsData : undefined,
          }))
        }
        return
      }

      if (dataPart.type === 'data-directions') {
        if (isDataEnvelope<DirectionsData>(dataPart.data)) {
          applyAttachedDataFromEnvelope(dataPart.data, (current, directionsData) => ({
            ...current,
            directions: directionsData,
          }))
        }
        return
      }

      if (dataPart.type === 'data-execution-trace') {
        if (isDataEnvelope<MessageExecutionStep[]>(dataPart.data)) {
          const envelope = dataPart.data
          activeRequestIdRef.current = envelope.requestId

          if (envelope.assistantMessageId) {
            requestToAssistantMessageIdRef.current.set(
              envelope.requestId,
              envelope.assistantMessageId
            )
            executionTraceByAssistantIdRef.current.set(
              envelope.assistantMessageId,
              envelope.data
            )
          } else {
            pendingExecutionTraceByRequestIdRef.current.set(envelope.requestId, envelope.data)
          }
        }
      }
    },
  })

  const isLoading =
    status === 'submitted' ||
    status === 'streaming' ||
    (requestPhase !== 'idle' && requestPhase !== 'error')

  // Load conversation messages when the URL conversation id changes. Guests
  // resolve from IndexedDB, signed-in users from the server. Never overwrite
  // the in-flight chat timeline while a request is active.
  useEffect(() => {
    const prev = prevConversationIdRef.current
    prevConversationIdRef.current = conversationId

    const idle =
      requestPhaseRef.current === 'idle' || requestPhaseRef.current === 'error'
    if (!idle) return

    // No active conversation, or a deliberate navigation to a different one:
    // start from a blank timeline.
    if (!conversationId || conversationId !== prev) {
      setMessages([])
      setAttachedDataMap(new Map())
      messageTimestampsByIdRef.current.clear()
      executionTraceByAssistantIdRef.current.clear()
      persistedAssistantMessageIdsRef.current.clear()
      isFirstExchangeRef.current = true
    }

    if (!conversationId) return

    const isLoadingTarget = isAuthenticated
      ? isLoadingConversation
      : isLoadingGuestConversation
    if (isLoadingTarget) return

    const sourceMessages = isAuthenticated
      ? loadedConversation?.messages
      : guestConversation?.messages
    if (!sourceMessages || sourceMessages.length === 0) return

    const sortedMessages = isAuthenticated
      ? sortMessagesByTurnOrderAsc(sourceMessages as Message[])
      : [...sourceMessages].sort((a, b) =>
          (a.created_at ?? '').localeCompare(b.created_at ?? '')
        )

    const uiMessages: ChatUIMessage[] = sortedMessages.map((storedMessage) => ({
      id: storedMessage.id,
      role: storedMessage.role as 'user' | 'assistant',
      metadata: { createdAt: storedMessage.created_at },
      parts: [
        {
          type: 'text' as const,
          text: storedMessage.visible_content ?? storedMessage.content,
        },
      ],
      createdAt: new Date(storedMessage.created_at),
    }))

    setMessages(uiMessages)

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
    persistedAssistantMessageIdsRef.current = persistedAssistantIds

    isFirstExchangeRef.current = sortedMessages.length > 0
  }, [
    conversationId,
    isAuthenticated,
    loadedConversation,
    guestConversation,
    isLoadingConversation,
    isLoadingGuestConversation,
    setMessages,
    setAttachedDataMap,
  ])

  // Flush any pending persistence retries on load.
  useEffect(() => {
    void flushOutboxNow()
  }, [flushOutboxNow])

  // Flush retries as soon as connectivity is restored.
  useEffect(() => {
    if (!isAuthenticated) return

    const handleOnline = () => {
      void flushOutboxNow()
    }

    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [isAuthenticated, flushOutboxNow])

  // Register handler for starting a new chat (called from sidebar via ChatContext)
  useEffect(() => {
    registerStartNewChatHandler(() => {
      stop()
      setMessages([])
      setAttachedDataMap(new Map())
      messageTimestampsByIdRef.current.clear()
      executionTraceByAssistantIdRef.current.clear()
      setRequestLifecyclePhase('idle')
      setError(null)
      setHomeTimeContext(null)
      pendingUserMessageRef.current = null
      pendingConversationIdRef.current = null
      pendingAssistantClientMessageIdRef.current = null
      pendingUserPersistencePromiseRef.current = null
      pendingUserPersistedMessageIdRef.current = null
      persistedAssistantMessageIdsRef.current.clear()
      activeHandoffIdRef.current = null
      isFirstExchangeRef.current = true
      resetRequestCorrelations()
    })
  }, [registerStartNewChatHandler, stop, setMessages, setAttachedDataMap, setRequestLifecyclePhase, resetRequestCorrelations])

  const handleSendMessage = useCallback(
    async (content: string, options?: { eventId?: string }) => {
      pendingTrendingEventIdRef.current = options?.eventId ?? null
      setError(null)
      resetRequestCorrelations()
      eventsCountRef.current = 0

      startTimeRef.current = Date.now()
      track('chat:message_sent', {
        query: content,
        message_length: content.length,
        has_history: messages.length > 0,
      })

      // No active conversation means this will be a first-message handoff:
      // mint the unique id NOW so the submit mark and the parked message
      // share it (the id travels through the remount).
      const handoffId = !conversationId ? generateId() : null
      if (handoffId) {
        markHandoffPhase('submit', handoffId)
      }

      pendingUserMessageRef.current = content
      pendingUserPersistedMessageIdRef.current = null
      const userClientMessageId = generateId()
      const assistantClientMessageId = generateId()
      pendingAssistantClientMessageIdRef.current = assistantClientMessageId

      try {
        // Resolve an active conversation: reuse the URL id, or create one.
        // Signed-in users create a server conversation; guests create a local
        // IndexedDB conversation keyed by a client-generated id in the URL.
        let currentConversationId = conversationId
        if (!currentConversationId) {
          // Invariant: this branch is only reachable when conversationId was
          // null, which is exactly when handoffId was minted at the top.
          if (!handoffId) {
            throw new Error('[chat] invariant: first-message branch without handoff id')
          }
          if (isAuthenticated) {
            const newConversation = await createConversation.mutateAsync(undefined)
            currentConversationId = newConversation.id
          } else {
            currentConversationId = generateId()
            // Persist the guest conversation WITHOUT blocking the navigation:
            // the IndexedDB write is fire-and-forget (safe-failure — a failed
            // write degrades to an in-memory chat for this session instead of
            // a stuck submit, and is logged). The query cache is seeded
            // synchronously below so the remounted /chat/:id instance resolves
            // the conversation instantly — no IndexedDB read on the critical
            // path, no full-pane loading spinner.
            createGuestConversation(currentConversationId)
              .then(() => markHandoffPhase('guest_conversation_written', handoffId))
              .catch((persistError) => {
                console.error(
                  '[chat] Failed to persist guest conversation to IndexedDB:',
                  persistError
                )
              })

            const nowIso = new Date().toISOString()
            queryClient.setQueryData(
              queryKeys.conversations.guestDetail(currentConversationId),
              {
                conversation: {
                  id: currentConversationId,
                  title: null,
                  created_at: nowIso,
                  updated_at: nowIso,
                },
                messages: [],
              }
            )
          }
          // First message of a new conversation: navigating to /chat/{id}
          // remounts this component, so sending here would stream the response
          // into an unmounted instance and it would never render. Park the
          // message in the ChatProvider (which survives the remount) and let
          // the instance that mounts at /chat/{id} send it.
          setIsHandoffPending(true)
          markHandoffPhase('navigate', handoffId)
          setPendingFirstMessage({ content, eventId: options?.eventId, handoffId })
          onConversationChange?.(currentConversationId)
          return
        }
        // Only enter the loading phase once we're streaming from THIS mounted
        // instance. For a first message the home screen parks the message and
        // navigates — the remounted /chat/{id} instance sets 'preparing'
        // itself, so the home hero stays visible until the switch (no flash
        // of a bare loading row on the home screen).
        setRequestLifecyclePhase('preparing')
        pendingConversationIdRef.current = currentConversationId

        const userMessagePayload: MessagePersistencePayload = {
          conversationId: currentConversationId,
          parentMessageId: null,
          clientMessageId: userClientMessageId,
          role: 'user',
          content,
          visibleContent: content,
          responseContractVersion: 2,
        }

        const userPersistencePromise = persistMessageResiliently(userMessagePayload)
          .then((result) => {
            if (result.messageId) {
              pendingUserPersistedMessageIdRef.current = result.messageId
            }
            markHandoffPhase('user_persisted')
            return result
          })
          .catch((persistError) => {
            console.error('Failed to persist user message:', persistError)
            return { status: 'queued' } as MessagePersistenceResult
          })

        pendingUserPersistencePromiseRef.current = userPersistencePromise

        markHandoffPhase('request_start')
        await sendMessage({
          text: content,
          metadata: { createdAt: new Date().toISOString() },
        })
        await userPersistencePromise
      } catch (err) {
        console.error('Failed to send message:', err)
        const errorMessage = err instanceof Error ? err.message : 'Failed to send message'
        setRequestLifecyclePhase('error')
        setError(errorMessage)
        toast.error('Failed to send message', {
          description: errorMessage,
          action: {
            label: 'Retry',
            onClick: () => handleSendMessage(content),
          },
        })
        pendingUserMessageRef.current = null
        pendingConversationIdRef.current = null
        pendingAssistantClientMessageIdRef.current = null
        pendingUserPersistencePromiseRef.current = null
        pendingUserPersistedMessageIdRef.current = null
        persistedAssistantMessageIdsRef.current.clear()
        // A failed send never appends the user message, so the optimistic
        // handoff copy would otherwise lock the composer forever.
        setPendingFirstMessageState(null)
        activeHandoffIdRef.current = null
        isHandoffRequestRef.current = false
        handoffMarksRef.current = {}
        resetRequestCorrelations()
      }
    },
    [
      conversationId,
      onConversationChange,
      createConversation,
      isAuthenticated,
      messages.length,
      persistMessageResiliently,
      resetRequestCorrelations,
      sendMessage,
      setRequestLifecyclePhase,
      markHandoffPhase,
    ]
  )

  // Consume a first-message handoff from the home screen: the previous
  // ChatContainer instance created the conversation, navigated here, and
  // parked the message for THIS (mounted) instance to send — sending from
  // the old instance would stream the response into an unmounted component.
  // One-shot: takePendingFirstMessage clears on read, so re-runs are no-ops.
  useEffect(() => {
    // Only consume the handoff once a conversation id is present. During the
    // route transition the previous instance may re-render without a
    // conversationId — taking the pending there would drop it before the
    // mounted /chat/{id} instance can send it.
    if (!conversationId) return
    const pending = takePendingFirstMessage()
    if (pending) {
      // The stream must start from THIS mounted instance — never from the
      // instance that navigated away (it would render into an unmounted tree).
      activeHandoffIdRef.current = pending.handoffId
      markHandoffPhase('consume')
      isHandoffRequestRef.current = true
      handleSendMessage(pending.content, { eventId: pending.eventId })
    }
  }, [conversationId, handleSendMessage, takePendingFirstMessage, markHandoffPhase])

  // Drop the optimistic first-message copy once sendMessage has appended the
  // real user message (same content), and re-enable the composer. Runs on the
  // remounted /chat/:id instance that consumed the handoff.
  useEffect(() => {
    if (!pendingFirstMessage) return
    const landed = messages.some(
      (message) =>
        message.role === 'user' &&
        extractVisibleTextFromUIMessageParts(
          message.parts as Array<{ type?: string; text?: string }>
        ) === pendingFirstMessage.content
    )
    if (landed) {
      setPendingFirstMessageState(null)
    }
  }, [messages, pendingFirstMessage])

  // Returning to the home screen (conversationId cleared) re-arms a composer
  // that was locked while a handoff was in flight on this instance.
  useEffect(() => {
    if (!conversationId) {
      setIsHandoffPending(false)
    }
  }, [conversationId])

  const chatMessages: ChatMessage[] = useMemo(() => {
    return messages.map((message, index) => {
      const textContent = extractVisibleTextFromUIMessageParts(
        message.parts as Array<{ type?: string; text?: string }>
      )

      const isLastAssistant = message.role === 'assistant' && index === messages.length - 1
      const isStreaming = isLastAssistant && status === 'streaming'

      const storedData =
        message.role === 'assistant'
          ? messageAttachedDataMap.get(message.id)
          : undefined

      return {
        id: message.id,
        role: message.role as 'user' | 'assistant',
        content: textContent,
        timestamp: resolveMessageTimestamp(message, messageTimestampsByIdRef.current),
        isStreaming,
        events: storedData?.events,
        suggestions: storedData?.suggestions,
        directions: storedData?.directions,
      }
    })
  }, [messages, messageAttachedDataMap, status])

  const displayMessages = useMemo(() => {
    const visible = chatMessages.filter((chatMessage) => {
      if (chatMessage.role === 'user') return true
      const hasVisibleContent =
        chatMessage.content.trim().length > 0 ||
        (chatMessage.events && chatMessage.events.length > 0) ||
        chatMessage.directions
      return hasVisibleContent || chatMessage.isStreaming
    })

    // Optimistic copy of the parked first message, rendered from the very
    // first frame of the remounted instance so the submitted text is visible
    // before the stream starts. Dropped as soon as sendMessage appends the
    // real user message (matched by role + content).
    if (!pendingFirstMessage) return visible
    const alreadyRendered = chatMessages.some(
      (chatMessage) =>
        chatMessage.role === 'user' && chatMessage.content === pendingFirstMessage.content
    )
    if (alreadyRendered) return visible

    return [
      {
        id: `pending-${pendingFirstMessage.content}`,
        role: 'user' as const,
        content: pendingFirstMessage.content,
        timestamp: new Date(),
        isStreaming: false,
      },
      ...visible,
    ]
  }, [chatMessages, pendingFirstMessage])

  const handleConversationScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (
        !conversationId ||
        restoredScrollConversationIdRef.current !== conversationId
      ) {
        return
      }

      saveConversationScrollPosition(conversationId, event.currentTarget.scrollTop)
    },
    [conversationId, saveConversationScrollPosition]
  )

  useEffect(() => {
    if (
      !conversationId ||
      displayMessages.length === 0 ||
      restoredScrollConversationIdRef.current === conversationId
    ) {
      return
    }

    const savedScrollTop = getConversationScrollPosition(conversationId)
    const frame = window.requestAnimationFrame(() => {
      const scrollContainer = containerRef.current
      if (!scrollContainer) return

      restoredScrollConversationIdRef.current = conversationId
      if (savedScrollTop !== null) {
        scrollContainer.scrollTop = savedScrollTop
      }
    })

    return () => window.cancelAnimationFrame(frame)
  }, [
    conversationId,
    containerRef,
    displayMessages.length,
    getConversationScrollPosition,
  ])

  const hasMessages = displayMessages.length > 0

  const lastAssistantMessage = [...chatMessages].reverse().find((message) => message.role === 'assistant')
  const showLoading = shouldShowLoadingIndicator(
    status as 'submitted' | 'streaming' | 'ready' | 'error',
    lastAssistantMessage,
    requestPhase
  )

  const loadingLabel = useMemo(() => {
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
  }, [requestPhase])

  // A parked first message must never sit behind the full-pane conversation
  // spinner or the "conversation not found" state: the handoff renders the
  // user's message immediately and streams from this instance, independent of
  // the (seeded) conversation query resolving.
  const hasPendingHandoff = !!pendingFirstMessage

  const showConversationLoading = !!(
    conversationId &&
    !hasPendingHandoff &&
    (isAuthenticated ? isLoadingConversation : isLoadingGuestConversation) &&
    requestPhase === 'idle' &&
    !hasMessages
  )

  const conversationMissing = !!(
    conversationId &&
    !hasPendingHandoff &&
    !(isAuthenticated ? isLoadingConversation : isLoadingGuestConversation) &&
    !(isAuthenticated ? !!loadedConversation : !!guestConversation) &&
    requestPhase === 'idle' &&
    !hasMessages
  )

  return (
    <div className="relative h-full min-h-0 flex flex-col">
      {error && (
        <div className="absolute top-4 left-4 right-4 z-50 max-w-3xl mx-auto p-3 bg-destructive/20 border border-destructive rounded-lg text-sm flex items-center justify-between animate-fade-in-up">
          <span>{error}</span>
          <button
            onClick={() => {
              setError(null)
              if (requestPhaseRef.current === 'error') {
                setRequestLifecyclePhase('idle')
              }
            }}
            className="ml-2 text-lg leading-none hover:opacity-70"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        onScroll={handleConversationScroll}
        className="flex-1 min-h-0 overflow-y-auto"
      >
        <PullToRefreshIndicator ref={indicatorRef} />

        {showConversationLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : conversationMissing ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
            <p className="text-muted-foreground">{m.chat_conversation_not_found()}</p>
            <Link
              to="/"
              className="text-sm font-medium text-primary hover:underline"
              onClick={() => setActiveConversationId(null)}
            >
              {m.chat_start_new_chat()}
            </Link>
          </div>
        ) : hasMessages || requestPhase !== 'idle' || hasPendingHandoff ? (
          <MessageList
            messages={displayMessages}
            isLoading={showLoading}
            loadingPhase={requestPhase}
            loadingLabel={loadingLabel}
            onSuggestionSelect={handleSendMessage}
          />
        ) : (
          <SuggestedPrompts
            onSelectPrompt={handleSendMessage}
            trendingEvents={trendingEvents}
            timeContext={homeTimeContext}
            onTimeContextChange={setHomeTimeContext}
          />
        )}
      </div>

      <div className="shrink-0 bg-background">
        <ChatInput
          onSend={handleSendMessage}
          disabled={isLoading || showConversationLoading || isHandoffPending || hasPendingHandoff}
          emphasized={!hasMessages && requestPhase === 'idle' && !conversationId}
        />
      </div>
    </div>
  )
}

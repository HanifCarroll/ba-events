import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
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
} from '@/shared/lib/types'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { SuggestedPrompts } from './SuggestedPrompts'
import { getLocale } from '@/paraglide/runtime'
import * as m from '@/paraglide/messages'
import { track } from '@/lib/analytics'
import { usePullToRefresh } from '@/shared/hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '@/shared/ui/PullToRefreshIndicator'
import { useChatContext } from '@/shared/providers/ChatProvider'
import {
  useConversation,
  useCreateConversation,
  useAddMessage,
  useGenerateTitle,
  useUpdateMessageAttachedData,
} from '@/features/chat/hooks/useConversations'
import { extractVisibleTextFromUIMessageParts } from '@/features/chat/lib/extract-visible-text'
import {
  flushMessagePersistenceOutbox,
  persistMessageWithOutbox,
  type MessagePersistencePayload,
  type MessagePersistenceResult,
} from '@/features/chat/lib/persistence-outbox'
import { useAuthContext } from '@/features/auth/hooks/useAuthContext'
import { sortMessagesByTurnOrderAsc } from '@/features/chat/lib/message-order'
import { confirmPlan } from '@/features/chat'

export type RequestPhase =
  | 'idle'
  | 'preparing'
  | 'thinking'
  | 'running_tool'
  | 'composing'
  | 'persisting'
  | 'error'

export function mapStatusPhaseToRequestPhase(phase: ChatStreamStatusPhase): RequestPhase {
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

type AssistantVisibilityMessage = Pick<ChatMessage, 'content' | 'events' | 'directions' | 'plan'>

export function assistantMessageHasVisibleContent(
  message: AssistantVisibilityMessage | null | undefined
): boolean {
  if (!message) return false
  return !!(
    message.content.trim().length > 0 ||
    (message.events && message.events.length > 0) ||
    message.directions ||
    message.plan
  )
}

export function shouldShowLoadingIndicator(
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

export function ChatContainer() {
  const [error, setError] = useState<string | null>(null)
  const [messageAttachedDataMap, setMessageAttachedDataMap] = useState<
    Map<string, MessageAttachedData>
  >(new Map())
  const messageAttachedDataMapRef = useRef<Map<string, MessageAttachedData>>(new Map())

  const startTimeRef = useRef<number>(0)
  const eventsCountRef = useRef<number>(0)

  // Conversation context
  const { activeConversationId, setActiveConversationId, registerStartNewChatHandler } =
    useChatContext()
  const { user } = useAuthContext()
  const isAuthenticated = !!user

  // Conversation hooks
  const { data: loadedConversation, isLoading: isLoadingConversation } =
    useConversation(activeConversationId)
  const createConversation = useCreateConversation()
  const addMessage = useAddMessage()
  const generateTitle = useGenerateTitle()
  const updateAttachedData = useUpdateMessageAttachedData()
  const [requestPhase, setRequestPhase] = useState<RequestPhase>('idle')
  const requestPhaseRef = useRef<RequestPhase>('idle')
  const [planningAssistantMessageId, setPlanningAssistantMessageId] = useState<string | null>(null)

  // Request correlation for message-scoped streamed attached data
  const activeRequestIdRef = useRef<string | null>(null)
  const requestToAssistantMessageIdRef = useRef<Map<string, string>>(new Map())
  const pendingAttachedDataByRequestIdRef = useRef<Map<string, MessageAttachedData>>(new Map())
  const pendingExecutionTraceByRequestIdRef = useRef<Map<string, MessageExecutionStep[]>>(new Map())
  const executionTraceByAssistantIdRef = useRef<Map<string, MessageExecutionStep[]>>(new Map())

  const setRequestLifecyclePhase = useCallback((phase: RequestPhase) => {
    requestPhaseRef.current = phase
    setRequestPhase(phase)
  }, [])

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
        return { status: 'persisted' }
      }

      return persistMessageWithOutbox(persistMessageToConversation, payload)
    },
    [isAuthenticated, persistMessageToConversation]
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
  } = useChat({
    id: chatSessionIdRef.current,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: () => ({
        locale: getLocale() as 'en' | 'es',
      }),
    }),
    onFinish: async ({ message }) => {
      track('chat:response_received', {
        duration_ms: Date.now() - startTimeRef.current,
        events_returned: eventsCountRef.current,
      })

      setRequestLifecyclePhase('persisting')

      const activeRequestId = activeRequestIdRef.current
      if (activeRequestId) {
        requestToAssistantMessageIdRef.current.set(activeRequestId, message.id)
        mergePendingDataIntoAssistantMessage(activeRequestId, message.id)
      }

      const conversationId = pendingConversationIdRef.current ?? activeConversationId
      if (conversationId) {
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
            conversationId,
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
              conversationId,
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
                  conversationId,
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

  // Load conversation messages when activeConversationId changes.
  // Never overwrite the in-flight chat timeline while a request is active.
  useEffect(() => {
    if (!activeConversationId || isLoadingConversation) return

    if (
      requestPhaseRef.current !== 'idle' &&
      requestPhaseRef.current !== 'error'
    ) {
      return
    }

      if (loadedConversation?.messages) {
        const sortedMessages = sortMessagesByTurnOrderAsc(loadedConversation.messages)

      const uiMessages: UIMessage[] = sortedMessages.map((storedMessage: Message) => ({
        id: storedMessage.id,
        role: storedMessage.role as 'user' | 'assistant',
        parts: [{ type: 'text' as const, text: storedMessage.visible_content ?? storedMessage.content }],
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
    }
  }, [activeConversationId, loadedConversation, isLoadingConversation, setMessages, setAttachedDataMap])

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
      executionTraceByAssistantIdRef.current.clear()
      setRequestLifecyclePhase('idle')
      setError(null)
      pendingUserMessageRef.current = null
      pendingConversationIdRef.current = null
      pendingAssistantClientMessageIdRef.current = null
      pendingUserPersistencePromiseRef.current = null
      pendingUserPersistedMessageIdRef.current = null
      persistedAssistantMessageIdsRef.current.clear()
      setPlanningAssistantMessageId(null)
      isFirstExchangeRef.current = true
      resetRequestCorrelations()
    })
  }, [registerStartNewChatHandler, stop, setMessages, setAttachedDataMap, setRequestLifecyclePhase, resetRequestCorrelations])

  const handleConfirmPlan = useCallback(
    async (assistantMessageId: string, event: EventWithVenue) => {
      if (planningAssistantMessageId) return

      setPlanningAssistantMessageId(assistantMessageId)

      try {
        const result = await confirmPlan(event.id)
        const plan = {
          event,
          plannedAt: result.plannedAt,
          persisted: result.persisted,
          requiresLogin: result.requiresLogin,
        }

        let nextAttachedData: MessageAttachedData | null = null
        upsertAttachedDataForAssistantMessage(assistantMessageId, (current) => {
          nextAttachedData = {
            ...current,
            plan,
          }
          return nextAttachedData
        })

        if (result.persisted && nextAttachedData) {
          const persistedMessageId =
            persistedAssistantMessageIdsRef.current.get(assistantMessageId) ?? assistantMessageId

          try {
            await updateAttachedData.mutateAsync({
              messageId: persistedMessageId,
              attachedData: nextAttachedData,
            })
          } catch (updateError) {
            console.error('Failed to persist plan attached data:', updateError)
            toast.warning('Plan saved, but chat history may need a refresh', {
              description: 'The event is saved in your plans, but this chat card may not sync until reload.',
            })
          }

          toast.success('Plan saved', {
            description: 'You can revisit it from Saved.',
          })
          return
        }

        toast.message('Plan ready for this session', {
          description: 'Sign in to save it permanently in your Saved plans.',
        })
      } catch (planError) {
        console.error('Failed to confirm plan:', planError)
        toast.error('Failed to confirm plan', {
          description: 'Try again in a moment.',
        })
      } finally {
        setPlanningAssistantMessageId(null)
      }
    },
    [planningAssistantMessageId, updateAttachedData, upsertAttachedDataForAssistantMessage]
  )

  const handleSendMessage = useCallback(
    async (content: string) => {
      setRequestLifecyclePhase('preparing')
      setError(null)
      resetRequestCorrelations()
      eventsCountRef.current = 0

      startTimeRef.current = Date.now()
      track('chat:message_sent', {
        query: content,
        message_length: content.length,
        has_history: messages.length > 0,
      })

      pendingUserMessageRef.current = content
      pendingUserPersistedMessageIdRef.current = null
      const userClientMessageId = generateId()
      const assistantClientMessageId = generateId()
      pendingAssistantClientMessageIdRef.current = assistantClientMessageId

      try {
        if (isAuthenticated) {
          let conversationId = activeConversationId
          if (!conversationId) {
            const newConversation = await createConversation.mutateAsync(undefined)
            conversationId = newConversation.id
            setActiveConversationId(conversationId)
          }
          pendingConversationIdRef.current = conversationId

          const userMessagePayload: MessagePersistencePayload = {
            conversationId,
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
              return result
            })
            .catch((persistError) => {
              console.error('Failed to persist user message:', persistError)
              return { status: 'queued' } as MessagePersistenceResult
            })

          pendingUserPersistencePromiseRef.current = userPersistencePromise

          await sendMessage({ text: content })
          await userPersistencePromise
          return
        }

        pendingConversationIdRef.current = null
        pendingUserPersistencePromiseRef.current = null
        await sendMessage({ text: content })
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
        resetRequestCorrelations()
      }
    },
    [
      activeConversationId,
      createConversation,
      isAuthenticated,
      messages.length,
      persistMessageResiliently,
      resetRequestCorrelations,
      sendMessage,
      setActiveConversationId,
      setRequestLifecyclePhase,
    ]
  )

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
        // UIMessage has no createdAt; timestamps are display-only here.
        timestamp: new Date(),
        isStreaming,
        events: storedData?.events,
        suggestions: storedData?.suggestions,
        directions: storedData?.directions,
        plan: storedData?.plan,
      }
    })
  }, [messages, messageAttachedDataMap, status])

  const displayMessages = useMemo(() => {
    return chatMessages.filter((chatMessage) => {
      if (chatMessage.role === 'user') return true
      const hasVisibleContent =
        chatMessage.content.trim().length > 0 ||
        (chatMessage.events && chatMessage.events.length > 0) ||
        chatMessage.directions ||
        chatMessage.plan
      return hasVisibleContent || chatMessage.isStreaming
    })
  }, [chatMessages])

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

  const showConversationLoading = !!(
    activeConversationId &&
    isLoadingConversation &&
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

      <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto touch-pan-y">
        <PullToRefreshIndicator ref={indicatorRef} />

        {showConversationLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : hasMessages || requestPhase !== 'idle' ? (
          <MessageList
            messages={displayMessages}
            isLoading={showLoading}
            loadingPhase={requestPhase}
            loadingLabel={loadingLabel}
            onSuggestionSelect={handleSendMessage}
            onConfirmPlan={handleConfirmPlan}
            planningAssistantMessageId={planningAssistantMessageId}
          />
        ) : (
          <SuggestedPrompts onSelectPrompt={handleSendMessage} />
        )}
      </div>

      <div className="shrink-0 bg-background">
        <ChatInput onSend={handleSendMessage} disabled={isLoading || showConversationLoading} />
      </div>
    </div>
  )
}

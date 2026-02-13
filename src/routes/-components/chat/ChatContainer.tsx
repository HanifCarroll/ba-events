import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { useChat, type UIMessage } from '@ai-sdk/react'
import { DefaultChatTransport, generateId } from 'ai'
import type {
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
} from '@/features/chat/hooks/useConversations'
import { extractVisibleTextFromUIMessageParts } from '@/features/chat/lib/extract-visible-text'
import {
  flushMessagePersistenceOutbox,
  persistMessageWithOutbox,
  type MessagePersistencePayload,
} from '@/features/chat/lib/persistence-outbox'
import { useAuthContext } from '@/features/auth/hooks/useAuthContext'

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

type AssistantVisibilityMessage = Pick<ChatMessage, 'content' | 'events' | 'directions'>

export function assistantMessageHasVisibleContent(
  message: AssistantVisibilityMessage | null | undefined
): boolean {
  if (!message) return false
  return !!(
    message.content.trim().length > 0 ||
    (message.events && message.events.length > 0) ||
    message.directions
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

export function ChatContainer() {
  // Track events, suggestions, directions, and errors separately (for streaming message)
  const [events, setEvents] = useState<EventWithVenue[]>([])
  const [suggestions, setSuggestions] = useState<RefinementSuggestion[]>([])
  const [directions, setDirections] = useState<DirectionsData | null>(null)
  const [executionTrace, setExecutionTrace] = useState<MessageExecutionStep[]>([])
  const [error, setError] = useState<string | null>(null)
  const startTimeRef = useRef<number>(0)
  const eventsCountRef = useRef<number>(0)

  // Store attached data for all loaded messages (keyed by message ID)
  const [messageAttachedDataMap, setMessageAttachedDataMap] = useState<
    Map<string, MessageAttachedData>
  >(new Map())

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
  const [requestPhase, setRequestPhase] = useState<RequestPhase>('idle')
  const requestPhaseRef = useRef<RequestPhase>('idle')

  const setRequestLifecyclePhase = useCallback((phase: RequestPhase) => {
    requestPhaseRef.current = phase
    setRequestPhase(phase)
  }, [])

  // Track if we've persisted the current user message (to avoid duplicates)
  const pendingUserMessageRef = useRef<string | null>(null)
  const pendingConversationIdRef = useRef<string | null>(null)
  const pendingAssistantClientMessageIdRef = useRef<string | null>(null)
  // Track if this is the first exchange (for title generation)
  const isFirstExchangeRef = useRef(true)
  const isFlushingOutboxRef = useRef(false)

  // Pull-to-refresh for mobile (uses direct DOM manipulation for 60fps)
  const { containerRef, indicatorRef } = usePullToRefresh({
    onRefresh: () => window.location.reload(),
  })

  const persistMessageToConversation = useCallback(
    async (payload: MessagePersistencePayload) => {
      await addMessage.mutateAsync({
        conversationId: payload.conversationId,
        role: payload.role,
        clientMessageId: payload.clientMessageId,
        content: payload.content,
        visibleContent: payload.visibleContent ?? payload.content,
        executionTrace: payload.executionTrace,
        responseContractVersion: payload.responseContractVersion ?? 2,
        attachedData: payload.attachedData,
      })
    },
    [addMessage]
  )

  const persistMessageResiliently = useCallback(
    async (payload: MessagePersistencePayload): Promise<'persisted' | 'queued'> => {
      if (!isAuthenticated) {
        await persistMessageToConversation(payload)
        return 'persisted'
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
    id: activeConversationId ?? 'ba-events-chat-new',
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: () => ({
        locale: getLocale() as 'en' | 'es',
      }),
    }),
    onFinish: async ({ message }) => {
      // Track response received with timing
      track('chat:response_received', {
        duration_ms: Date.now() - startTimeRef.current,
        events_returned: eventsCountRef.current,
      })

      setRequestLifecyclePhase('persisting')

      // Persist the assistant message with attached data
      const conversationId = pendingConversationIdRef.current ?? activeConversationId
      if (conversationId) {
        // Extract final-only visible text from step-aware parts
        const textContent = extractVisibleTextFromUIMessageParts(
          message.parts as Array<{ type?: string; text?: string }>
        )

        const attachedData = {
          events: events.length > 0 ? events : undefined,
          suggestions: suggestions.length > 0 ? suggestions : undefined,
          directions: directions ?? undefined,
        }
        const assistantClientMessageId =
          pendingAssistantClientMessageIdRef.current ?? generateId()

        try {
          await persistMessageResiliently({
            conversationId,
            clientMessageId: assistantClientMessageId,
            role: 'assistant',
            content: textContent,
            visibleContent: textContent,
            executionTrace,
            responseContractVersion: 2,
            attachedData,
          })

          // Generate title after first exchange
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

      pendingUserMessageRef.current = null
      pendingConversationIdRef.current = null
      pendingAssistantClientMessageIdRef.current = null
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
    },
    onData: (dataPart) => {
      // Handle custom data parts from the server
      if (dataPart.type === 'data-events') {
        const eventsData = dataPart.data as EventWithVenue[]
        setEvents(eventsData)
        eventsCountRef.current = eventsData.length

        // Track no results for content gap analysis
        if (eventsData.length === 0) {
          track('chat:no_results', {})
        }
      } else if (dataPart.type === 'data-suggestions') {
        setSuggestions(dataPart.data as RefinementSuggestion[])
      } else if (dataPart.type === 'data-directions') {
        setDirections(dataPart.data as DirectionsData)
      } else if (dataPart.type === 'data-execution-trace') {
        setExecutionTrace(dataPart.data as MessageExecutionStep[])
      } else if (dataPart.type === 'data-status') {
        const statusData = dataPart.data as ChatStreamStatusData
        setRequestLifecyclePhase(mapStatusPhaseToRequestPhase(statusData.phase))
      }
    },
  })

  const isLoading =
    status === 'submitted' ||
    status === 'streaming' ||
    (requestPhase !== 'idle' && requestPhase !== 'error')

  // Load conversation messages when activeConversationId changes
  useEffect(() => {
    if (!activeConversationId || isLoadingConversation) return

    if (loadedConversation?.messages) {
      // Convert stored messages to UI format
      const uiMessages: UIMessage[] = loadedConversation.messages.map((m: Message) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        parts: [{ type: 'text' as const, text: m.visible_content ?? m.content }],
        createdAt: new Date(m.created_at),
      }))

      setMessages(uiMessages)

      // Build a map of all message attached data for historical display
      const attachedDataMap = new Map<string, MessageAttachedData>()
      for (const m of loadedConversation.messages) {
        if (m.role === 'assistant' && m.attached_data) {
          attachedDataMap.set(m.id, m.attached_data)
        }
      }
      setMessageAttachedDataMap(attachedDataMap)

      // For the last assistant message, also set the live state
      // (so streaming new messages works correctly)
      const lastAssistant = loadedConversation.messages
        .filter((m: Message) => m.role === 'assistant')
        .pop()

      if (lastAssistant?.attached_data) {
        const data = lastAssistant.attached_data
        if (data.events) setEvents(data.events)
        if (data.suggestions) setSuggestions(data.suggestions)
        if (data.directions) setDirections(data.directions)
      }

      // Not the first exchange if loading existing conversation
      isFirstExchangeRef.current = false
    }
  }, [activeConversationId, loadedConversation, isLoadingConversation, setMessages])

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
      setEvents([])
      setSuggestions([])
      setDirections(null)
      setExecutionTrace([])
      setMessageAttachedDataMap(new Map())
      setRequestLifecyclePhase('idle')
      pendingUserMessageRef.current = null
      pendingConversationIdRef.current = null
      pendingAssistantClientMessageIdRef.current = null
      isFirstExchangeRef.current = true
    })
  }, [registerStartNewChatHandler, stop, setMessages, setRequestLifecyclePhase])

  // Clear events, suggestions, directions, and errors when starting a new message
  const handleSendMessage = useCallback(
    async (content: string) => {
      setRequestLifecyclePhase('preparing')

      // Clear previous data
      setEvents([])
      setSuggestions([])
      setDirections(null)
      setExecutionTrace([])
      setError(null)

      // Track message sent
      startTimeRef.current = Date.now()
      eventsCountRef.current = 0
      track('chat:message_sent', {
        query: content,
        message_length: content.length,
        has_history: messages.length > 0,
      })

      // Store the user message for title generation
      pendingUserMessageRef.current = content
      const userClientMessageId = generateId()
      const assistantClientMessageId = generateId()
      pendingAssistantClientMessageIdRef.current = assistantClientMessageId

      try {
        // Create conversation if this is the first message
        let conversationId = activeConversationId
        if (!conversationId) {
          const newConversation = await createConversation.mutateAsync(undefined)
          conversationId = newConversation.id
          setActiveConversationId(conversationId)
        }
        pendingConversationIdRef.current = conversationId

        // Persist in the background so first-message UX is instant.
        const userMessagePayload: MessagePersistencePayload = {
          conversationId,
          clientMessageId: userClientMessageId,
          role: 'user',
          content,
          visibleContent: content,
          responseContractVersion: 2,
        }
        const userPersistencePromise = persistMessageResiliently(userMessagePayload).catch((persistError) => {
          console.error('Failed to persist user message:', persistError)
          if (!isAuthenticated) {
            toast.error('Failed to save your message locally')
          }
        })

        // Send the message using AI SDK
        await sendMessage({ text: content })
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
      }
    },
    [
      messages.length,
      sendMessage,
      activeConversationId,
      setActiveConversationId,
      createConversation,
      persistMessageResiliently,
      isAuthenticated,
      setRequestLifecyclePhase,
    ]
  )

  // Convert AI SDK messages to our ChatMessage format for display
  const chatMessages: ChatMessage[] = useMemo(() => {
    return messages.map((m, index) => {
      // Extract text content from parts
      const textContent = extractVisibleTextFromUIMessageParts(
        m.parts as Array<{ type?: string; text?: string }>
      )

      const isLastAssistant = m.role === 'assistant' && index === messages.length - 1
      const isStreaming = isLastAssistant && status === 'streaming'

      // For the last assistant message, use live streaming data
      // For historical messages, look up from the attached data map
      let messageEvents: EventWithVenue[] | undefined
      let messageSuggestions: RefinementSuggestion[] | undefined
      let messageDirections: DirectionsData | undefined

      if (m.role === 'assistant') {
        if (isLastAssistant) {
          // Use live streaming state for the current message
          messageEvents = events.length > 0 ? events : undefined
          messageSuggestions = suggestions.length > 0 ? suggestions : undefined
          messageDirections = directions ?? undefined
        } else {
          // Look up historical attached data
          const storedData = messageAttachedDataMap.get(m.id)
          if (storedData) {
            messageEvents = storedData.events
            messageSuggestions = storedData.suggestions
            messageDirections = storedData.directions
          }
        }
      }

      return {
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: textContent,
        timestamp: new Date(),
        isStreaming,
        events: messageEvents,
        suggestions: messageSuggestions,
        directions: messageDirections,
      }
    })
  }, [messages, events, suggestions, directions, status, messageAttachedDataMap])

  // Filter out empty assistant messages that have completed (no content to show)
  const displayMessages = useMemo(() => {
    return chatMessages.filter((m) => {
      // Always show user messages
      if (m.role === 'user') return true
      // For assistant messages, show if has any content OR is still streaming
      const hasVisibleContent =
        m.content.trim().length > 0 || (m.events && m.events.length > 0) || m.directions
      return hasVisibleContent || m.isStreaming
    })
  }, [chatMessages])

  const hasMessages = displayMessages.length > 0

  // Show loading indicator when:
  // 1. Status is 'submitted' (waiting for response to start), OR
  // 2. Status is 'streaming' but no visible content yet (Claude is doing tool calls)
  // Use the latest assistant message from raw chat state (not filtered display state).
  // This keeps loader behavior tied to the in-flight assistant turn.
  const lastAssistantMessage = [...chatMessages].reverse().find((m) => m.role === 'assistant')
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

  // Show loading state while fetching conversation, but never while an active request is in flight.
  const showConversationLoading = !!(
    activeConversationId &&
    isLoadingConversation &&
    requestPhase === 'idle' &&
    !hasMessages
  )

  return (
    <div className="relative h-full min-h-0 flex flex-col">
      {/* Error banner */}
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

      {/* Message area - scrollable */}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto touch-pan-y">
        {/* Pull-to-refresh indicator (controlled via DOM manipulation) */}
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
          />
        ) : (
          <SuggestedPrompts onSelectPrompt={handleSendMessage} />
        )}
      </div>

      {/* Input - at bottom */}
      <div className="shrink-0 bg-background">
        <ChatInput onSend={handleSendMessage} disabled={isLoading || showConversationLoading} />
      </div>
    </div>
  )
}

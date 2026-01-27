import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { useChat, type UIMessage } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type {
  ChatMessage,
  EventWithVenue,
  RefinementSuggestion,
  DirectionsData,
  Message,
  MessageAttachedData,
} from '@/shared/lib/types'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { SuggestedPrompts } from './SuggestedPrompts'
import { getLocale } from '@/paraglide/runtime'
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

export function ChatContainer() {
  // Track events, suggestions, directions, and errors separately (for streaming message)
  const [events, setEvents] = useState<EventWithVenue[]>([])
  const [suggestions, setSuggestions] = useState<RefinementSuggestion[]>([])
  const [directions, setDirections] = useState<DirectionsData | null>(null)
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

  // Conversation hooks
  const { data: loadedConversation, isLoading: isLoadingConversation } =
    useConversation(activeConversationId)
  const createConversation = useCreateConversation()
  const addMessage = useAddMessage()
  const generateTitle = useGenerateTitle()

  // Track if we've persisted the current user message (to avoid duplicates)
  const pendingUserMessageRef = useRef<string | null>(null)
  // Track if this is the first exchange (for title generation)
  const isFirstExchangeRef = useRef(true)

  // Pull-to-refresh for mobile (uses direct DOM manipulation for 60fps)
  const { containerRef, indicatorRef } = usePullToRefresh({
    onRefresh: () => window.location.reload(),
  })

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

      // Persist the assistant message with attached data
      if (activeConversationId) {
        // Extract text content from the message (outside try so it's accessible in catch)
        const textContent =
          message.parts
            ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map((p) => p.text)
            .join('') ?? ''

        const attachedData = {
          events: events.length > 0 ? events : undefined,
          suggestions: suggestions.length > 0 ? suggestions : undefined,
          directions: directions ?? undefined,
        }

        try {
          await addMessage.mutateAsync({
            conversationId: activeConversationId,
            role: 'assistant',
            content: textContent,
            attachedData,
          })

          // Generate title after first exchange
          if (isFirstExchangeRef.current && pendingUserMessageRef.current) {
            isFirstExchangeRef.current = false
            generateTitle.mutate({
              conversationId: activeConversationId,
              firstMessage: pendingUserMessageRef.current,
            })
          }
        } catch (err) {
          console.error('Failed to persist assistant message:', err)
          toast.error('Failed to save response', {
            description: 'Your conversation may not be saved properly',
            action: {
              label: 'Retry',
              onClick: () => {
                // Re-attempt to save the message
                addMessage.mutate({
                  conversationId: activeConversationId,
                  role: 'assistant',
                  content: textContent,
                  attachedData,
                })
              },
            },
          })
        }
      }

      pendingUserMessageRef.current = null
    },
    onError: (err) => {
      console.error('Chat error:', err)
      setError(err.message || 'An error occurred. Please try again.')
      track('chat:error', {
        error_type: 'client_error',
        error_message: err.message,
      })
      pendingUserMessageRef.current = null
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
      }
    },
  })

  const isLoading = status === 'submitted' || status === 'streaming'

  // Load conversation messages when activeConversationId changes
  useEffect(() => {
    if (!activeConversationId || isLoadingConversation) return

    if (loadedConversation?.messages) {
      // Convert stored messages to UI format
      const uiMessages: UIMessage[] = loadedConversation.messages.map((m: Message) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        parts: [{ type: 'text' as const, text: m.content }],
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

  // Register handler for starting a new chat (called from sidebar via ChatContext)
  useEffect(() => {
    registerStartNewChatHandler(() => {
      stop()
      setMessages([])
      setEvents([])
      setSuggestions([])
      setDirections(null)
      setMessageAttachedDataMap(new Map())
      isFirstExchangeRef.current = true
    })
  }, [registerStartNewChatHandler, stop, setMessages])

  // Clear events, suggestions, directions, and errors when starting a new message
  const handleSendMessage = useCallback(
    async (content: string) => {
      // Clear previous data
      setEvents([])
      setSuggestions([])
      setDirections(null)
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

      try {
        // Create conversation if this is the first message
        let conversationId = activeConversationId
        if (!conversationId) {
          const newConversation = await createConversation.mutateAsync(undefined)
          conversationId = newConversation.id
          setActiveConversationId(conversationId)
        }

        // Persist the user message
        await addMessage.mutateAsync({
          conversationId: conversationId!,
          role: 'user',
          content,
        })

        // Send the message using AI SDK
        await sendMessage({ text: content })
      } catch (err) {
        console.error('Failed to send message:', err)
        const errorMessage = err instanceof Error ? err.message : 'Failed to send message'
        setError(errorMessage)
        toast.error('Failed to send message', {
          description: errorMessage,
          action: {
            label: 'Retry',
            onClick: () => handleSendMessage(content),
          },
        })
        pendingUserMessageRef.current = null
      }
    },
    [
      messages.length,
      sendMessage,
      activeConversationId,
      setActiveConversationId,
      createConversation,
      addMessage,
    ]
  )

  // Convert AI SDK messages to our ChatMessage format for display
  const chatMessages: ChatMessage[] = useMemo(() => {
    return messages.map((m, index) => {
      // Extract text content from parts
      const textContent = m.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('')

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
  const lastAssistantMessage = displayMessages.filter((m) => m.role === 'assistant').pop()
  const hasVisibleAssistantContent =
    lastAssistantMessage &&
    (lastAssistantMessage.content.trim().length > 0 ||
      (lastAssistantMessage.events && lastAssistantMessage.events.length > 0) ||
      lastAssistantMessage.directions)
  const showLoading =
    status === 'submitted' || (status === 'streaming' && !hasVisibleAssistantContent)

  // Show loading state while fetching conversation
  const showConversationLoading = !!(activeConversationId && isLoadingConversation)

  return (
    <div className="relative h-full min-h-0 flex flex-col">
      {/* Error banner */}
      {error && (
        <div className="absolute top-4 left-4 right-4 z-50 max-w-3xl mx-auto p-3 bg-destructive/20 border border-destructive rounded-lg text-sm flex items-center justify-between animate-fade-in-up">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
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
        ) : hasMessages ? (
          <MessageList
            messages={displayMessages}
            isLoading={showLoading}
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

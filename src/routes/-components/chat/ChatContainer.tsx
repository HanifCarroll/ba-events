import { useState, useCallback, useRef, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { ChatMessage, EventWithVenue, RefinementSuggestion, DirectionsData } from '@/shared/lib/types'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { SuggestedPrompts } from './SuggestedPrompts'
import { getLocale } from '@/paraglide/runtime'
import { track } from '@/lib/analytics'
import { usePullToRefresh } from '@/shared/hooks/usePullToRefresh'
import { PullToRefreshIndicator } from '@/shared/ui/PullToRefreshIndicator'

export function ChatContainer() {
  // Track events, suggestions, and directions separately since they come as data parts
  const [events, setEvents] = useState<EventWithVenue[]>([])
  const [suggestions, setSuggestions] = useState<RefinementSuggestion[]>([])
  const [directions, setDirections] = useState<DirectionsData | null>(null)
  const startTimeRef = useRef<number>(0)
  const eventsCountRef = useRef<number>(0)

  // Pull-to-refresh for mobile
  const { containerRef, pullDistance, isRefreshing } = usePullToRefresh({
    onRefresh: () => window.location.reload(),
  })

  const {
    messages,
    sendMessage,
    status,
    setMessages,
    stop,
  } = useChat({
    id: 'ba-events-chat',
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: () => ({
        locale: getLocale() as 'en' | 'es',
      }),
    }),
    onFinish: () => {
      // Track response received with timing
      track('chat:response_received', {
        duration_ms: Date.now() - startTimeRef.current,
        events_returned: eventsCountRef.current,
      })
    },
    onError: (err) => {
      console.error('Chat error:', err)
      track('chat:error', {
        error_type: 'client_error',
        error_message: err.message,
      })
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

  // Notify header about chat state changes
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('chat-state-change', {
      detail: { hasMessages: messages.length > 0 }
    }))
  }, [messages.length])

  // Listen for new-chat event from header
  useEffect(() => {
    const handleNewChat = () => {
      stop()
      setMessages([])
      setEvents([])
      setSuggestions([])
      setDirections(null)
    }
    window.addEventListener('new-chat', handleNewChat)
    return () => window.removeEventListener('new-chat', handleNewChat)
  }, [stop, setMessages])

  // Clear events, suggestions, and directions when starting a new message
  const handleSendMessage = useCallback(async (content: string) => {
    // Clear previous data
    setEvents([])
    setSuggestions([])
    setDirections(null)

    // Track message sent
    startTimeRef.current = Date.now()
    eventsCountRef.current = 0
    track('chat:message_sent', {
      message_length: content.length,
      has_history: messages.length > 0,
    })

    // Send the message using AI SDK
    await sendMessage({ text: content })
  }, [messages.length, sendMessage])

  // Convert AI SDK messages to our ChatMessage format for display
  const chatMessages: ChatMessage[] = messages.map((m, index) => {
    // Extract text content from parts
    const textContent = m.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map(p => p.text)
      .join('')

    // For the last assistant message, include events and suggestions
    const isLastAssistant = m.role === 'assistant' && index === messages.length - 1

    return {
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: textContent,
      timestamp: new Date(),
      isStreaming: isLastAssistant && status === 'streaming',
      events: isLastAssistant ? events : undefined,
      suggestions: isLastAssistant ? suggestions : undefined,
      directions: isLastAssistant && directions ? directions : undefined,
    }
  })

  // Filter out empty assistant messages that have completed (no content to show)
  const displayMessages = chatMessages.filter(m => {
    // Always show user messages
    if (m.role === 'user') return true
    // For assistant messages, show if has any content OR is still streaming
    const hasVisibleContent = m.content.trim().length > 0 || (m.events && m.events.length > 0) || m.directions
    return hasVisibleContent || m.isStreaming
  })

  const hasMessages = displayMessages.length > 0

  // Show loading indicator when:
  // 1. Status is 'submitted' (waiting for response to start), OR
  // 2. Status is 'streaming' but no visible content yet (Claude is doing tool calls)
  const lastAssistantMessage = displayMessages.filter(m => m.role === 'assistant').pop()
  const hasVisibleAssistantContent = lastAssistantMessage && (
    lastAssistantMessage.content.trim().length > 0 ||
    (lastAssistantMessage.events && lastAssistantMessage.events.length > 0) ||
    lastAssistantMessage.directions
  )
  const showLoading = status === 'submitted' || (status === 'streaming' && !hasVisibleAssistantContent)

  return (
    <div className="relative h-full min-h-0 flex flex-col">
      {/* Message area - scrollable */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-y-auto touch-pan-y"
      >
        {/* Pull-to-refresh indicator */}
        <PullToRefreshIndicator
          pullDistance={pullDistance}
          isRefreshing={isRefreshing}
        />

        {hasMessages ? (
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
        <ChatInput onSend={handleSendMessage} disabled={isLoading} />
      </div>
    </div>
  )
}

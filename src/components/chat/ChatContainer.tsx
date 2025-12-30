import { useState, useCallback, useRef, useEffect } from 'react'
import type { ChatMessage, ChatState, StreamEvent, EventWithVenue, APIMessage } from '@/lib/types'
import { generateId } from '@/lib/chat'
import { chat } from '@/lib/ai'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { SuggestedPrompts } from './SuggestedPrompts'
import { getLocale } from '@/paraglide/runtime'
import { track } from '@/lib/analytics'

export function ChatContainer() {
  const [state, setState] = useState<ChatState>({
    messages: [],
    apiHistory: [], // Full API history for Claude (includes tool_use/tool_result blocks)
    isLoading: false,
  })
  const abortControllerRef = useRef<AbortController | null>(null)
  const startTimeRef = useRef<number>(0)
  const eventsCountRef = useRef<number>(0)

  // Notify header about chat state changes
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('chat-state-change', {
      detail: { hasMessages: state.messages.length > 0 }
    }))
  }, [state.messages.length])

  // Listen for new-chat event from header
  useEffect(() => {
    const handleNewChat = () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      setState({
        messages: [],
        apiHistory: [],
        isLoading: false,
      })
    }
    window.addEventListener('new-chat', handleNewChat)
    return () => window.removeEventListener('new-chat', handleNewChat)
  }, [])

  const handleSendMessage = useCallback(async (content: string) => {
    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    // Create user message
    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: new Date(),
    }

    // Create placeholder for assistant message
    const assistantMessage: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    }

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage, assistantMessage],
      isLoading: true,
    }))

    try {
      // Use full API history for proper multi-turn tool use conversations
      // This includes tool_use and tool_result blocks, not just text
      const history = state.apiHistory

      // Get the current locale
      const locale = getLocale() as 'en' | 'es'

      // Track message sent
      startTimeRef.current = Date.now()
      eventsCountRef.current = 0
      track('chat:message_sent', {
        message_length: content.length,
        has_history: history.length > 0,
      })

      // Call the server function with full API history and locale
      const stream = await chat({ data: { message: content, history, locale } })

      if (!stream) {
        throw new Error('No response stream received')
      }

      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let accumulatedContent = ''
      let events: EventWithVenue[] | undefined
      let hasReceivedContent = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete SSE events from buffer
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: StreamEvent = JSON.parse(line.slice(6))

              if (event.type === 'text') {
                accumulatedContent += event.content
                // Hide loading indicator as soon as content starts streaming
                const shouldHideLoading = !hasReceivedContent
                hasReceivedContent = true
                setState(prev => ({
                  ...prev,
                  isLoading: shouldHideLoading ? false : prev.isLoading,
                  messages: prev.messages.map(m =>
                    m.id === assistantMessage.id
                      ? { ...m, content: accumulatedContent }
                      : m
                  ),
                }))
              } else if (event.type === 'events') {
                events = event.data
                eventsCountRef.current = event.data.length

                // Track no results for content gap analysis
                if (event.data.length === 0) {
                  track('chat:no_results', {
                    message_length: content.length,
                  })
                }

                // Also hide loading when events arrive
                const shouldHideLoading = !hasReceivedContent
                hasReceivedContent = true
                setState(prev => ({
                  ...prev,
                  isLoading: shouldHideLoading ? false : prev.isLoading,
                  messages: prev.messages.map(m =>
                    m.id === assistantMessage.id
                      ? { ...m, events }
                      : m
                  ),
                }))
              } else if (event.type === 'error') {
                // Track stream error
                track('chat:error', {
                  error_type: 'stream_error',
                  error_message: event.message,
                })

                accumulatedContent += `\n\n*Error: ${event.message}*`
                setState(prev => ({
                  ...prev,
                  messages: prev.messages.map(m =>
                    m.id === assistantMessage.id
                      ? { ...m, content: accumulatedContent }
                      : m
                  ),
                }))
              } else if (event.type === 'history') {
                // Server sends full history of new messages for this exchange
                // Append user message + all new messages to apiHistory
                setState(prev => ({
                  ...prev,
                  apiHistory: [
                    ...prev.apiHistory,
                    { role: 'user', content } as APIMessage, // User's text message
                    ...event.messages, // All messages from this exchange (tool_use, tool_result, final text)
                  ],
                }))
              } else if (event.type === 'done') {
                // Track response received with timing
                track('chat:response_received', {
                  duration_ms: Date.now() - startTimeRef.current,
                  events_returned: eventsCountRef.current,
                  has_text: accumulatedContent.length > 0,
                })

                // Mark streaming as complete
                setState(prev => ({
                  ...prev,
                  messages: prev.messages.map(m =>
                    m.id === assistantMessage.id
                      ? { ...m, isStreaming: false }
                      : m
                  ),
                  isLoading: false,
                }))
              }
            } catch (parseError) {
              console.error('Failed to parse SSE event:', parseError)
            }
          }
        }
      }

      // Ensure loading state is cleared even if 'done' event wasn't received
      setState(prev => ({
        ...prev,
        messages: prev.messages.map(m =>
          m.id === assistantMessage.id
            ? { ...m, isStreaming: false }
            : m
        ),
        isLoading: false,
      }))
    } catch (error) {
      console.error('Chat error:', error)

      // Track client-side error
      track('chat:error', {
        error_type: 'client_error',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      })

      // Update assistant message with error
      setState(prev => ({
        ...prev,
        messages: prev.messages.map(m =>
          m.id === assistantMessage.id
            ? {
                ...m,
                content: "I'm sorry, I encountered an error while processing your request. Please try again.",
                isStreaming: false,
              }
            : m
        ),
        isLoading: false,
      }))
    }
  }, [state.messages])

  const hasMessages = state.messages.length > 0

  return (
    <div className="relative h-full min-h-0 flex flex-col">
      {/* Message area - scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {hasMessages ? (
          <MessageList messages={state.messages} isLoading={state.isLoading} />
        ) : (
          <SuggestedPrompts onSelectPrompt={handleSendMessage} />
        )}
      </div>

      {/* Input - at bottom */}
      <div className="shrink-0 bg-background">
        <ChatInput onSend={handleSendMessage} disabled={state.isLoading} />
      </div>
    </div>
  )
}

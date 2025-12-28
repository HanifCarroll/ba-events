import { useState, useCallback, useRef } from 'react'
import type { ChatMessage, ChatState, StreamEvent, EventWithVenue, APIMessage } from '@/lib/types'
import { generateId } from '@/lib/chat'
import { chat } from '@/lib/ai'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { SuggestedPrompts } from './SuggestedPrompts'

export function ChatContainer() {
  const [state, setState] = useState<ChatState>({
    messages: [],
    apiHistory: [], // Full API history for Claude (includes tool_use/tool_result blocks)
    isLoading: false,
  })
  const abortControllerRef = useRef<AbortController | null>(null)

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

      // Call the server function with full API history
      const stream = await chat({ data: { message: content, history } })

      if (!stream) {
        throw new Error('No response stream received')
      }

      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let accumulatedContent = ''
      let events: EventWithVenue[] | undefined

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
                setState(prev => ({
                  ...prev,
                  messages: prev.messages.map(m =>
                    m.id === assistantMessage.id
                      ? { ...m, content: accumulatedContent }
                      : m
                  ),
                }))
              } else if (event.type === 'events') {
                events = event.data
                setState(prev => ({
                  ...prev,
                  messages: prev.messages.map(m =>
                    m.id === assistantMessage.id
                      ? { ...m, events }
                      : m
                  ),
                }))
              } else if (event.type === 'error') {
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
    <div className="flex flex-col h-full">
      {hasMessages ? (
        <MessageList messages={state.messages} isLoading={state.isLoading} />
      ) : (
        <SuggestedPrompts onSelectPrompt={handleSendMessage} />
      )}
      <ChatInput onSend={handleSendMessage} disabled={state.isLoading} />
    </div>
  )
}

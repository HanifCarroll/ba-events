import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { ChatMessage } from './ChatMessage'
import type { ChatMessage as ChatMessageType } from '@/lib/types'

interface MessageListProps {
  messages: ChatMessageType[]
  isLoading?: boolean
  onSuggestionSelect?: (prompt: string) => void
}

export function MessageList({ messages, isLoading = false, onSuggestionSelect }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevMessageCountRef = useRef(messages.length)

  // Auto-scroll only when a NEW message is added (not during streaming updates)
  useEffect(() => {
    const messageCount = messages.length
    const prevCount = prevMessageCountRef.current

    // Only scroll if message count increased (new message added)
    if (messageCount > prevCount && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }

    prevMessageCountRef.current = messageCount
  }, [messages.length])

  return (
    <div className="p-4 sm:p-6">
      <div className="max-w-3xl mx-auto">
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            onSuggestionSelect={onSuggestionSelect}
            suggestionsDisabled={isLoading}
          />
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex justify-start mb-4 animate-fade-in-up">
            <div className="bg-card border border-border/50 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex items-center gap-3 text-muted-foreground">
                <Sparkles className="h-4 w-4 text-primary animate-pulse-warm" />
                <span className="text-sm tracking-wide">Thinking</span>
                <span className="flex gap-1">
                  <span className="w-1 h-1 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-1 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-1 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

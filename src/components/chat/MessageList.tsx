import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { ChatMessage } from './ChatMessage'
import type { ChatMessage as ChatMessageType } from '@/lib/types'

interface MessageListProps {
  messages: ChatMessageType[]
  isLoading?: boolean
}

export function MessageList({ messages, isLoading = false }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isLoading])

  return (
    <div className="p-4 sm:p-6">
      <div className="max-w-3xl mx-auto">
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
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

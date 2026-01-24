import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { ChatMessage } from './ChatMessage'
import type { ChatMessage as ChatMessageType } from '@/shared/lib/types'
import * as m from '@/paraglide/messages'

interface MessageListProps {
  messages: ChatMessageType[]
  isLoading?: boolean
  onSuggestionSelect?: (prompt: string) => void
}

export function MessageList({ messages, isLoading = false, onSuggestionSelect }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevMessageCountRef = useRef(messages.length)
  const isUserScrollingRef = useRef(false)

  // Track when user is manually scrolling to avoid fighting with auto-scroll
  useEffect(() => {
    const container = containerRef.current?.parentElement
    if (!container) return

    let scrollTimeout: ReturnType<typeof setTimeout>

    const handleScroll = () => {
      isUserScrollingRef.current = true
      clearTimeout(scrollTimeout)
      // Reset after scroll settles (500ms matches smooth scroll duration)
      scrollTimeout = setTimeout(() => {
        isUserScrollingRef.current = false
      }, 500)
    }

    // Use passive listener for better scroll performance on mobile
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      clearTimeout(scrollTimeout)
    }
  }, [])

  // Auto-scroll only when a NEW message is added (not during streaming updates)
  // Skip if user is actively scrolling to avoid fighting touch gestures
  useEffect(() => {
    const messageCount = messages.length
    const prevCount = prevMessageCountRef.current

    // Only scroll if message count increased and user isn't manually scrolling
    if (messageCount > prevCount && bottomRef.current && !isUserScrollingRef.current) {
      // Use 'instant' on mobile to avoid smooth scroll fighting with touch gestures
      // Detect touch device by checking for touch points or coarse pointer
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
      bottomRef.current.scrollIntoView({
        behavior: isTouchDevice ? 'instant' : 'smooth',
        block: 'end',
      })
    }

    prevMessageCountRef.current = messageCount
  }, [messages.length])

  return (
    <div ref={containerRef} className="p-4 sm:p-6">
      <div
        className="max-w-3xl mx-auto"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
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
                <span className="text-sm tracking-wide">{m.chat_thinking()}</span>
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

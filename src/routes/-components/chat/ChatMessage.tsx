import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import { Sparkles } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { ChatMessage as ChatMessageType } from '@/shared/lib/types'
import { EventList } from './../events/EventList'
import { RefinementSuggestions } from './RefinementSuggestions'
import { DirectionsCard } from './DirectionsCard'

interface ChatMessageProps {
  message: ChatMessageType
  onSuggestionSelect?: (prompt: string) => void
  suggestionsDisabled?: boolean
}

export const ChatMessage = memo(function ChatMessage({
  message,
  onSuggestionSelect,
  suggestionsDisabled,
}: ChatMessageProps) {
  const isUser = message.role === 'user'
  const hasContent = message.content.trim().length > 0
  const hasEvents = message.events && message.events.length > 0
  const hasSuggestions = message.suggestions && message.suggestions.length > 0
  const hasDirections = !!message.directions

  // Don't render empty assistant messages that are still streaming (waiting for tool results)
  // The loading indicator in MessageList handles this state
  if (!isUser && !hasContent && !hasEvents && !hasDirections && message.isStreaming) {
    return null
  }

  return (
    <div
      className={cn(
        'flex w-full mb-8 animate-fade-in-up',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {!isUser && (
        <div className="mr-3 mt-1 hidden sm:flex h-7 w-7 shrink-0 items-center justify-center text-accent">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </div>
      )}
      <div
        className={cn(
          isUser ? 'max-w-[88%] sm:max-w-[52%]' : 'min-w-0 max-w-full flex-1',
          isUser ? 'order-1' : 'order-1'
        )}
      >
        {/* Only render the text bubble if there's content */}
        {hasContent && (
          <div
            className={cn(
              'text-[15px] leading-relaxed',
              isUser
                ? 'rounded-xl bg-muted px-4 py-3 text-foreground'
                : 'px-0 py-0 text-foreground'
            )}
          >
            {isUser ? (
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
            ) : (
              <div className="prose prose-sm prose-warm max-w-[68ch] leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1.5 [&_ul]:my-2 [&_ol]:my-2 [&_strong]:text-foreground [&_strong]:font-semibold">
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* Event results for assistant messages */}
        {!isUser && hasEvents && (
          <div className={hasContent ? 'mt-4' : ''}>
            <EventList events={message.events!} />
          </div>
        )}

        {/* Directions card for assistant messages */}
        {!isUser && hasDirections && (
          <div className={hasContent || hasEvents ? 'mt-4' : ''}>
            <DirectionsCard directions={message.directions!} />
          </div>
        )}

        {/* Refinement suggestions - show after events when not streaming */}
        {!isUser && hasSuggestions && !message.isStreaming && onSuggestionSelect && (
          <RefinementSuggestions
            suggestions={message.suggestions!}
            onSelect={onSuggestionSelect}
            disabled={suggestionsDisabled}
          />
        )}

        {/* Timestamp - only show when there's content or message is complete */}
        {(hasContent || hasEvents || hasDirections || !message.isStreaming) && (
          <p
            className={cn(
              'text-[11px] text-muted-foreground mt-2',
              isUser ? 'text-right pr-1' : 'text-left pl-1'
            )}
          >
            {message.timestamp.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}
      </div>
    </div>
  )
})

import ReactMarkdown from 'react-markdown'
import { cn } from '@/shared/lib/utils'
import type { ChatMessage as ChatMessageType } from '@/shared/lib/types'
import { EventList } from './../events/EventList'
import { RefinementSuggestions } from './RefinementSuggestions'

interface ChatMessageProps {
  message: ChatMessageType
  onSuggestionSelect?: (prompt: string) => void
  suggestionsDisabled?: boolean
}

export function ChatMessage({ message, onSuggestionSelect, suggestionsDisabled }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const hasContent = message.content.trim().length > 0
  const hasEvents = message.events && message.events.length > 0
  const hasSuggestions = message.suggestions && message.suggestions.length > 0

  // Don't render empty assistant messages that are still streaming (waiting for tool results)
  // The loading indicator in MessageList handles this state
  if (!isUser && !hasContent && !hasEvents && message.isStreaming) {
    return null
  }

  return (
    <div
      className={cn(
        'flex w-full mb-5 animate-fade-in-up',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      <div
        className={cn(
          'max-w-[85%] md:max-w-[75%]',
          isUser ? 'order-1' : 'order-1'
        )}
      >
        {/* Only render the text bubble if there's content */}
        {hasContent && (
          <div
            className={cn(
              'rounded-2xl px-4 py-3',
              isUser
                ? 'bg-primary text-primary-foreground rounded-br-md glow-gold'
                : 'bg-card border border-border/50 rounded-bl-md'
            )}
          >
            {isUser ? (
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
            ) : (
              <div className="text-sm prose prose-sm prose-warm max-w-none leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_strong]:text-foreground [&_strong]:font-semibold">
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

        {/* Refinement suggestions - show after events when not streaming */}
        {!isUser && hasSuggestions && !message.isStreaming && onSuggestionSelect && (
          <RefinementSuggestions
            suggestions={message.suggestions!}
            onSelect={onSuggestionSelect}
            disabled={suggestionsDisabled}
          />
        )}

        {/* Timestamp - only show when there's content or message is complete */}
        {(hasContent || hasEvents || !message.isStreaming) && (
          <p
            className={cn(
              'text-[10px] text-muted-foreground/60 mt-1.5 tracking-wide',
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
}

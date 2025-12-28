import ReactMarkdown from 'react-markdown'
import { cn } from '@/lib/utils'
import type { ChatMessage as ChatMessageType } from '@/lib/types'
import { EventList } from '@/components/events/EventList'

interface ChatMessageProps {
  message: ChatMessageType
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const hasContent = message.content.trim().length > 0
  const hasEvents = message.events && message.events.length > 0

  // Don't render empty assistant messages that are still streaming (waiting for tool results)
  // The loading indicator in MessageList handles this state
  if (!isUser && !hasContent && !hasEvents && message.isStreaming) {
    return null
  }

  return (
    <div
      className={cn(
        'flex w-full mb-4',
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
              'rounded-2xl px-4 py-2',
              isUser
                ? 'bg-primary text-primary-foreground rounded-br-md'
                : 'bg-muted rounded-bl-md'
            )}
          >
            {isUser ? (
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
            ) : (
              <div className="text-sm prose prose-sm prose-neutral dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* Event results for assistant messages */}
        {!isUser && hasEvents && (
          <div className={hasContent ? 'mt-3' : ''}>
            <EventList events={message.events!} />
          </div>
        )}

        {/* Timestamp - only show when there's content or message is complete */}
        {(hasContent || hasEvents || !message.isStreaming) && (
          <p
            className={cn(
              'text-xs text-muted-foreground mt-1',
              isUser ? 'text-right' : 'text-left'
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

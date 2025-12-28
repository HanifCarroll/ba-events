import { cn } from '@/lib/utils'
import type { ChatMessage as ChatMessageType } from '@/lib/types'
import { EventList } from '@/components/events/EventList'

interface ChatMessageProps {
  message: ChatMessageType
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'

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
        <div
          className={cn(
            'rounded-2xl px-4 py-2',
            isUser
              ? 'bg-primary text-primary-foreground rounded-br-md'
              : 'bg-muted rounded-bl-md'
          )}
        >
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>

        {/* Event results for assistant messages */}
        {!isUser && message.events && message.events.length > 0 && (
          <div className="mt-3">
            <EventList events={message.events} />
          </div>
        )}

        {/* Timestamp */}
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
      </div>
    </div>
  )
}

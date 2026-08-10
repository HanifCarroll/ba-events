import { Link, useParams } from '@tanstack/react-router'
import { MessageCircle } from 'lucide-react'
import { useConversations } from '@/features/chat/hooks/useConversations'
import * as m from '@/paraglide/messages'

interface ConversationHistoryProps {
  collapsed: boolean
}

/**
 * Signed-in conversation history shown in the sidebar. Each item deep-links to
 * the conversation's `/chat/:conversationId` URL.
 */
export function ConversationHistory({ collapsed }: ConversationHistoryProps) {
  const { data } = useConversations({ limit: 50 })
  const { conversationId } = useParams({ strict: false })
  const conversations = data?.conversations ?? []

  if (conversations.length === 0) return null

  return (
    <div className="flex flex-col gap-1 mt-3 pt-3 border-t border-border/50">
      <div
        className={`px-3 py-1 transition-all duration-300 ${
          collapsed ? 'opacity-0 h-0 overflow-hidden' : 'opacity-100'
        }`}
      >
        <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
          {m.chat_history()}
        </span>
      </div>
      {conversations.map((conversation) => {
        const active = conversation.id === conversationId
        return (
          <Link
            key={conversation.id}
            to="/chat/$conversationId"
            params={{ conversationId: conversation.id }}
            title={conversation.title || undefined}
            className={`
              group flex items-center gap-2.5 rounded-lg px-3.5 py-2 min-h-9
              transition-colors duration-200
              ${
                active
                  ? 'bg-primary/[0.07] text-primary'
                  : 'text-foreground/60 hover:text-foreground hover:bg-muted'
              }
              ${collapsed ? 'lg:px-3 lg:justify-center' : ''}
            `}
          >
            <MessageCircle className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <span className="font-medium truncate text-sm">
                {conversation.title || m.chat_untitled()}
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}

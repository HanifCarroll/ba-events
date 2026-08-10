import { useCallback } from 'react'
import { useNavigate, useParams, useLoaderData } from '@tanstack/react-router'
import type { ChatEventPayload } from '@/shared/lib/types'
import { ChatContainer } from './ChatContainer'

/**
 * Shared page for the chat routes. Reads the active conversation id from the
 * `/chat/:conversationId` URL (absent on `/`) and drives the URL when a
 * new conversation is created, so every chat has a stable address.
 */
export function ChatPage() {
  const navigate = useNavigate()
  const { conversationId } = useParams({ strict: false })
  // The home route prefetches trending events in its loader so the grid
  // renders on first paint. strict:false resolves the nearest matching route
  // (ChatPage renders under / and /chat/$conversationId).
  const { trending } = useLoaderData({ strict: false }) as {
    trending?: ChatEventPayload[]
  }

  const handleConversationChange = useCallback(
    (id: string) => {
      navigate({ to: '/chat/$conversationId', params: { conversationId: id } })
    },
    [navigate]
  )

  return (
    <div className="h-full flex flex-col">
      <ChatContainer
        conversationId={conversationId}
        trendingEvents={trending}
        onConversationChange={handleConversationChange}
      />
    </div>
  )
}

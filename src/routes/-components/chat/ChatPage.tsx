import { useCallback } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { ChatContainer } from './ChatContainer'

/**
 * Shared page for the chat routes. Reads the active conversation id from the
 * `/chat/:conversationId` URL (absent on `/chat`) and drives the URL when a
 * new conversation is created, so every chat has a stable address.
 */
export function ChatPage() {
  const navigate = useNavigate()
  const { conversationId } = useParams({ strict: false })

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
        onConversationChange={handleConversationChange}
      />
    </div>
  )
}

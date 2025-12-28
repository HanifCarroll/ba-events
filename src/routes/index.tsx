import { createFileRoute } from '@tanstack/react-router'
import { ChatContainer } from '@/components/chat'

export const Route = createFileRoute('/')({ component: ChatPage })

function ChatPage() {
  return (
    <main className="flex-1 min-h-0">
      <ChatContainer />
    </main>
  )
}

import { createFileRoute } from '@tanstack/react-router'
import { ChatContainer } from '@/components/chat'

export const Route = createFileRoute('/')({ component: ChatPage })

function ChatPage() {
  return (
    <main className="h-[calc(100vh-4rem)]">
      <ChatContainer />
    </main>
  )
}

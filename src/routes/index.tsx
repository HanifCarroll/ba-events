import { createFileRoute } from '@tanstack/react-router'
import { ChatContainer } from '@/routes/-components/chat'

export const Route = createFileRoute('/')({ component: ChatPage })

function ChatPage() {
  return (
    <div className="h-full flex flex-col">
      <ChatContainer />
    </div>
  )
}

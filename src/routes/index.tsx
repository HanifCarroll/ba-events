import { createFileRoute } from '@tanstack/react-router'
import { ChatContainer } from '@/components/chat'

export const Route = createFileRoute('/')({ component: ChatPage })

function ChatPage() {
  return <ChatContainer />
}

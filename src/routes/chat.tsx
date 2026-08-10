import { createFileRoute } from '@tanstack/react-router'
import { ChatPage } from '@/routes/-components/chat/ChatPage'

export const Route = createFileRoute('/chat')({
  component: ChatPage,
})

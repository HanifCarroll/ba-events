import { createFileRoute } from '@tanstack/react-router'
import { ChatContainer } from '@/routes/-components/chat'
import { useMigrateOnLogin } from '@/features/auth/hooks/useMigrateOnLogin'

export const Route = createFileRoute('/')({ component: ChatPage })

function ChatPage() {
  // Run migration on login (if local conversations exist)
  useMigrateOnLogin()

  return (
    <div className="h-full flex flex-col">
      <ChatContainer />
    </div>
  )
}

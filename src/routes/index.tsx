import { createFileRoute } from '@tanstack/react-router'
import { ChatPage } from '@/routes/-components/chat/ChatPage'
import { getTrendingEventsAction } from '@/features/events/api/crud'

export const Route = createFileRoute('/')({
  loader: async () => {
    // Prefetch trending events so the "Happening soon" cards render on first
    // paint (no skeleton gap). Loader data is serialized to the client, and
    // TrendingEvents seeds its useQuery with it via initialData.
    const trending = await getTrendingEventsAction()
    return { trending }
  },
  component: ChatPage,
})

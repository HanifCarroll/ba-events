import { useState, useCallback } from 'react'
import type { ChatMessage, ChatState, EventWithVenue } from '@/lib/types'
import {
  createUserMessage,
  createAssistantMessage,
  parseUserIntent,
  intentToFilters,
  generateResponse,
} from '@/lib/chat'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { SuggestedPrompts } from './SuggestedPrompts'

// Mock event data for development
const MOCK_EVENTS: EventWithVenue[] = [
  {
    id: '1',
    name: 'Techno Underground at Club 69',
    description: 'Deep techno night featuring local DJs. Expect dark, hypnotic beats until sunrise.',
    starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    ends_at: new Date(Date.now() + 31 * 60 * 60 * 1000).toISOString(),
    is_all_day: false,
    venue_id: '1',
    venue_name: 'Club 69',
    venue_neighborhood: 'Palermo',
    venue_address: 'Niceto Vega 5510',
    venue_type: 'club',
    categories: ['techno', 'electronic'],
    vibes: ['underground', 'high-energy'],
    price: 8000,
    is_free: false,
    min_age: 18,
    image_url: null,
    link: 'https://example.com/club69',
    ticket_url: 'https://example.com/club69/tickets',
    source: 'manual',
    status: 'scheduled',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '2',
    name: 'Jazz en el Jardín',
    description: 'Live jazz in a beautiful garden setting. Perfect for a relaxed evening with good music and wine.',
    starts_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    ends_at: new Date(Date.now() + 51.5 * 60 * 60 * 1000).toISOString(),
    is_all_day: false,
    venue_id: '2',
    venue_name: 'Jardín Secreto',
    venue_neighborhood: 'San Telmo',
    venue_address: 'Defensa 1455',
    venue_type: 'bar',
    categories: ['jazz'],
    vibes: ['chill', 'romantic', 'intimate'],
    price: 5000,
    is_free: false,
    min_age: null,
    image_url: null,
    link: 'https://example.com/jardin',
    ticket_url: null,
    source: 'manual',
    status: 'scheduled',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '3',
    name: 'Feria de San Telmo',
    description: 'The famous Sunday antique market. Browse vintage items, street food, and live tango performances.',
    starts_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    ends_at: new Date(Date.now() + 79 * 60 * 60 * 1000).toISOString(),
    is_all_day: false,
    venue_id: '3',
    venue_name: 'Plaza Dorrego',
    venue_neighborhood: 'San Telmo',
    venue_address: 'Defensa y Humberto Primo',
    venue_type: 'outdoor',
    categories: ['market', 'art', 'tango'],
    vibes: ['family-friendly', 'touristy', 'outdoor'],
    price: null,
    is_free: true,
    min_age: null,
    image_url: null,
    link: 'https://example.com/feria',
    ticket_url: null,
    source: 'manual',
    status: 'scheduled',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
]

// Simulate filtering events based on intent
function filterMockEvents(filters: ReturnType<typeof intentToFilters>): EventWithVenue[] {
  return MOCK_EVENTS.filter(event => {
    // Category filter
    if (filters.categories && filters.categories.length > 0) {
      const hasCategory = filters.categories.some(cat =>
        event.categories.includes(cat)
      )
      if (!hasCategory) return false
    }

    // Vibe filter
    if (filters.vibes && filters.vibes.length > 0) {
      const hasVibe = filters.vibes.some(vibe =>
        event.vibes.includes(vibe)
      )
      if (!hasVibe) return false
    }

    // Neighborhood filter
    if (filters.neighborhood && event.venue_neighborhood !== filters.neighborhood) {
      return false
    }

    // Free filter
    if (filters.isFree && !event.is_free) {
      return false
    }

    // Price filter
    if (filters.maxPrice && event.price && event.price > filters.maxPrice) {
      return false
    }

    return true
  })
}

export function ChatContainer() {
  const [state, setState] = useState<ChatState>({
    messages: [],
    isLoading: false,
  })

  const handleSendMessage = useCallback(async (content: string) => {
    // Add user message
    const userMessage = createUserMessage(content)
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isLoading: true,
    }))

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 500))

    // Parse intent and get mock response
    const intent = parseUserIntent(content)
    const filters = intentToFilters(intent)
    const events = filterMockEvents(filters)
    const responseText = generateResponse(intent, events)

    // Add assistant message
    const assistantMessage = createAssistantMessage(responseText, events.length > 0 ? events : undefined)
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, assistantMessage],
      isLoading: false,
    }))
  }, [])

  const hasMessages = state.messages.length > 0

  return (
    <div className="flex flex-col h-full">
      {hasMessages ? (
        <MessageList messages={state.messages} isLoading={state.isLoading} />
      ) : (
        <SuggestedPrompts onSelectPrompt={handleSendMessage} />
      )}
      <ChatInput onSend={handleSendMessage} disabled={state.isLoading} />
    </div>
  )
}

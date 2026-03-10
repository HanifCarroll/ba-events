import type { ChatMessage, EventWithVenue, EventFilters, Neighborhood, Category } from '@/shared/lib/types'
import { CATEGORIES, NEIGHBORHOODS } from '@/shared/lib/types'

// Generate unique ID for messages
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// Create a user message
export function createUserMessage(content: string): ChatMessage {
  return {
    id: generateId(),
    role: 'user',
    content,
    timestamp: new Date(),
  }
}

// Create an assistant message
export function createAssistantMessage(content: string, events?: EventWithVenue[]): ChatMessage {
  return {
    id: generateId(),
    role: 'assistant',
    content,
    events,
    timestamp: new Date(),
  }
}

// Parse user intent from message
interface ParsedIntent {
  timeFilter?: 'tonight' | 'tomorrow' | 'weekend' | 'week'
  categories?: Category[]
  neighborhood?: Neighborhood
  isFree?: boolean
  maxPrice?: number
}

export function parseUserIntent(message: string): ParsedIntent {
  const lowerMessage = message.toLowerCase()
  const intent: ParsedIntent = {}

  // Time patterns
  if (lowerMessage.includes('tonight') || lowerMessage.includes('today')) {
    intent.timeFilter = 'tonight'
  } else if (lowerMessage.includes('tomorrow')) {
    intent.timeFilter = 'tomorrow'
  } else if (lowerMessage.includes('weekend') || lowerMessage.includes('saturday') || lowerMessage.includes('sunday')) {
    intent.timeFilter = 'weekend'
  } else if (lowerMessage.includes('week')) {
    intent.timeFilter = 'week'
  }

  // Category patterns
  const foundCategories: Category[] = []
  for (const category of CATEGORIES) {
    if (lowerMessage.includes(category)) {
      foundCategories.push(category)
    }
  }
  if (foundCategories.length > 0) {
    intent.categories = foundCategories
  }

  // Neighborhood patterns
  for (const neighborhood of NEIGHBORHOODS) {
    if (lowerMessage.includes(neighborhood.toLowerCase())) {
      intent.neighborhood = neighborhood
      break
    }
  }

  // Price patterns
  if (lowerMessage.includes('free') || lowerMessage.includes('gratis')) {
    intent.isFree = true
  } else if (lowerMessage.includes('cheap') || lowerMessage.includes('budget')) {
    intent.maxPrice = 5000
  }

  return intent
}

// Convert parsed intent to EventFilters
export function intentToFilters(intent: ParsedIntent): EventFilters {
  const filters: EventFilters = {}
  const now = new Date()

  // Time filter
  if (intent.timeFilter === 'tonight') {
    const tonight = new Date(now)
    tonight.setHours(18, 0, 0, 0)
    const tomorrowMorning = new Date(tonight)
    tomorrowMorning.setDate(tomorrowMorning.getDate() + 1)
    tomorrowMorning.setHours(6, 0, 0, 0)
    filters.startsAfter = tonight.toISOString()
    filters.startsBefore = tomorrowMorning.toISOString()
  } else if (intent.timeFilter === 'tomorrow') {
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)
    const dayAfter = new Date(tomorrow)
    dayAfter.setDate(dayAfter.getDate() + 1)
    filters.startsAfter = tomorrow.toISOString()
    filters.startsBefore = dayAfter.toISOString()
  } else if (intent.timeFilter === 'weekend') {
    const dayOfWeek = now.getDay()
    const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7
    const saturday = new Date(now)
    saturday.setDate(saturday.getDate() + daysUntilSaturday)
    saturday.setHours(0, 0, 0, 0)
    const monday = new Date(saturday)
    monday.setDate(monday.getDate() + 2)
    filters.startsAfter = saturday.toISOString()
    filters.startsBefore = monday.toISOString()
  } else if (intent.timeFilter === 'week') {
    filters.startsAfter = now.toISOString()
    const nextWeek = new Date(now)
    nextWeek.setDate(nextWeek.getDate() + 7)
    filters.startsBefore = nextWeek.toISOString()
  } else {
    // Default: upcoming events
    filters.startsAfter = now.toISOString()
  }

  // Other filters
  if (intent.categories) {
    filters.categories = intent.categories
  }
  if (intent.neighborhood) {
    filters.neighborhood = intent.neighborhood
  }
  if (intent.isFree) {
    filters.isFree = true
  }
  if (intent.maxPrice) {
    filters.maxPrice = intent.maxPrice
  }

  return filters
}

// Generate natural language response based on intent and results
export function generateResponse(intent: ParsedIntent, events: EventWithVenue[]): string {
  if (events.length === 0) {
    let response = "I couldn't find any events"
    if (intent.timeFilter) {
      response += ` ${intent.timeFilter === 'tonight' ? 'tonight' : intent.timeFilter === 'tomorrow' ? 'tomorrow' : intent.timeFilter === 'weekend' ? 'this weekend' : 'this week'}`
    }
    if (intent.categories?.length) {
      response += ` for ${intent.categories.join(', ')}`
    }
    if (intent.neighborhood) {
      response += ` in ${intent.neighborhood}`
    }
    response += '. Try broadening your search or checking back later!'
    return response
  }

  let response = ''

  // Opening line based on count
  if (events.length === 1) {
    response = 'I found 1 event that matches what you\'re looking for:'
  } else if (events.length <= 5) {
    response = `I found ${events.length} events for you:`
  } else {
    response = `Great news! I found ${events.length} events. Here are some highlights:`
  }

  // Add context based on intent
  if (intent.timeFilter === 'tonight') {
    response = `Here's what's happening tonight! ${response}`
  } else if (intent.categories?.includes('music')) {
    response = `🎵 ${response}`
  } else if (intent.categories?.includes('arts')) {
    response = `🎭 ${response}`
  } else if (intent.categories?.includes('food')) {
    response = `🍽️ ${response}`
  } else if (intent.categories?.includes('festival')) {
    response = `🎉 ${response}`
  } else if (intent.isFree) {
    response = `Free events alert! ${response}`
  }

  return response
}

// Format price for display
export function formatPrice(price: number | null, isFree: boolean): string {
  if (isFree) return 'Free'
  if (price === null) return 'Price TBA'
  return `$${price.toLocaleString('es-AR')} ARS`
}

// Format date/time for display
export function formatEventTime(startsAt: string, endsAt: string | null): string {
  const start = new Date(startsAt)
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }

  let result = start.toLocaleDateString('en-US', options)

  if (endsAt) {
    const end = new Date(endsAt)
    const endTime = end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    result += ` - ${endTime}`
  }

  return result
}

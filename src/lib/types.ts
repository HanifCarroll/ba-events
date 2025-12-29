// All 48 official CABA neighborhoods
export const NEIGHBORHOODS = [
  'Agronomía',
  'Almagro',
  'Balvanera',
  'Barracas',
  'Belgrano',
  'Boedo',
  'Caballito',
  'Chacarita',
  'Coghlan',
  'Colegiales',
  'Constitución',
  'Flores',
  'Floresta',
  'La Boca',
  'La Paternal',
  'Liniers',
  'Mataderos',
  'Monte Castro',
  'Monserrat',
  'Nueva Pompeya',
  'Núñez',
  'Palermo',
  'Parque Avellaneda',
  'Parque Chacabuco',
  'Parque Chas',
  'Parque Patricios',
  'Puerto Madero',
  'Recoleta',
  'Retiro',
  'Saavedra',
  'San Cristóbal',
  'San Nicolás',
  'San Telmo',
  'Vélez Sársfield',
  'Versalles',
  'Villa Crespo',
  'Villa del Parque',
  'Villa Devoto',
  'Villa General Mitre',
  'Villa Lugano',
  'Villa Luro',
  'Villa Ortúzar',
  'Villa Pueyrredón',
  'Villa Real',
  'Villa Riachuelo',
  'Villa Santa Rita',
  'Villa Soldati',
  'Villa Urquiza',
] as const

export type Neighborhood = (typeof NEIGHBORHOODS)[number]

// Venue types
export const VENUE_TYPES = [
  'club',
  'bar',
  'theater',
  'gallery',
  'cultural_center',
  'outdoor',
  'restaurant',
  'other',
] as const

export type VenueType = (typeof VENUE_TYPES)[number]

// Event status
export const EVENT_STATUSES = ['scheduled', 'cancelled', 'postponed', 'past', 'pending_review'] as const

export type EventStatus = (typeof EVENT_STATUSES)[number]

// Common event categories
export const CATEGORIES = [
  'techno',
  'house',
  'electronic',
  'jazz',
  'rock',
  'indie',
  'latin',
  'tango',
  'classical',
  'hip-hop',
  'reggaeton',
  'folk',
  'art',
  'theatre',
  'comedy',
  'film',
  'food',
  'market',
  'festival',
  'workshop',
  'networking',
  'sports',
  'other',
] as const

export type Category = (typeof CATEGORIES)[number]

// Event vibes
export const VIBES = [
  'underground',
  'mainstream',
  'chill',
  'high-energy',
  'romantic',
  'family-friendly',
  'lgbtq-friendly',
  'expat-friendly',
  'local',
  'touristy',
  'intimate',
  'massive',
  'outdoor',
  'rooftop',
] as const

export type Vibe = (typeof VIBES)[number]

// Database venue record
export interface Venue {
  id: string
  name: string
  neighborhood: Neighborhood | null
  address: string | null
  website: string | null
  instagram_handle: string | null
  capacity: number | null
  type: VenueType
  created_at: string
  updated_at: string
}

// For inserting new venues
export interface VenueInsert {
  name: string
  neighborhood?: Neighborhood | null
  address?: string | null
  website?: string | null
  instagram_handle?: string | null
  capacity?: number | null
  type?: VenueType
}

// For updating venues
export type VenueUpdate = Partial<VenueInsert>

// Database event record
export interface Event {
  id: string
  name: string
  description: string | null
  starts_at: string // ISO datetime string
  ends_at: string | null // ISO datetime string
  is_all_day: boolean
  venue_id: string | null
  categories: string[]
  vibes: string[]
  price: number | null // in ARS
  is_free: boolean
  min_age: number | null // null means all ages
  image_url: string | null
  link: string | null
  ticket_url: string | null
  source: string
  external_id: string | null // ID from external source for deduplication
  status: EventStatus
  embedding?: number[]
  created_at: string
  updated_at: string
}

// Event with venue details (from view)
export interface EventWithVenue extends Event {
  venue_name: string | null
  venue_neighborhood: Neighborhood | null
  venue_address: string | null
  venue_type: VenueType | null
}

// For inserting new events
export interface EventInsert {
  name: string
  description?: string | null
  starts_at: string
  ends_at?: string | null
  is_all_day?: boolean
  venue_id?: string | null
  categories?: string[]
  vibes?: string[]
  price?: number | null
  is_free?: boolean
  min_age?: number | null
  image_url?: string | null
  link?: string | null
  ticket_url?: string | null
  source: string
  external_id?: string | null
  status?: EventStatus
  embedding?: number[]
}

// For updating events
export type EventUpdate = Partial<EventInsert>

// Search result with similarity score
export interface EventSearchResult extends Omit<Event, 'embedding'> {
  similarity: number
}

// Filters for querying events
export interface EventFilters {
  startsAfter?: string // ISO datetime
  startsBefore?: string // ISO datetime
  neighborhood?: Neighborhood
  venueId?: string
  categories?: string[]
  vibes?: string[]
  isFree?: boolean
  maxPrice?: number
  minAge?: number
  status?: EventStatus
}

// Content block types for Claude API messages
export type TextBlock = { type: 'text'; text: string }
export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
export type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

// API message format (for sending to Claude)
export interface APIMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

// Chat message types (for UI display)
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string // Display text
  events?: EventWithVenue[]
  timestamp: Date
  isStreaming?: boolean
}

export interface ChatState {
  messages: ChatMessage[]
  apiHistory: APIMessage[] // Full API history for Claude
  isLoading: boolean
}

// Streaming event types
export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'events'; data: EventWithVenue[] }
  | { type: 'history'; messages: APIMessage[] }
  | { type: 'error'; message: string }
  | { type: 'done' }

// Conversation history for API (legacy - use APIMessage instead)
export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

// Suggested prompts for empty state
export const SUGGESTED_PROMPTS = [
  {
    text: "What's happening tonight?",
    icon: 'calendar',
  },
  {
    text: 'Find me underground techno events',
    icon: 'music',
  },
  {
    text: 'Free events this weekend',
    icon: 'ticket',
  },
  {
    text: 'Best jazz spots in San Telmo',
    icon: 'map-pin',
  },
] as const

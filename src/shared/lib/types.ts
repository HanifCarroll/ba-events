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

// Event status
export const EVENT_STATUSES = ['scheduled', 'cancelled', 'postponed', 'past', 'pending_review'] as const

export type EventStatus = (typeof EVENT_STATUSES)[number]

// Enrichment status (for both events and venues)
export const ENRICHMENT_STATUSES = ['pending', 'in_progress', 'completed', 'failed'] as const

export type EnrichmentStatus = (typeof ENRICHMENT_STATUSES)[number]

// Simplified intent-based categories (reduced from 23 to 6)
export const CATEGORIES = [
  'music',
  'arts',
  'food',
  'social',
  'sports',
  'festival',
] as const

export type Category = (typeof CATEGORIES)[number]

// Database venue record
export interface Venue {
  id: string
  name: string
  neighborhood: Neighborhood | null
  address: string | null
  website: string | null
  instagram_handle: string | null
  parent_id: string | null
  enrichment_status: EnrichmentStatus
  enrichment_error: string | null
  enriched_at: string | null
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
  parent_id?: string | null
  enrichment_status?: EnrichmentStatus
  enrichment_error?: string | null
  enriched_at?: string | null
}

// For updating venues
export type VenueUpdate = Partial<VenueInsert>

// Database event record
export interface Event {
  id: string
  name: string
  description_es: string | null // Spanish description (primary, used for embedding)
  description_en: string | null // English description (for display)
  starts_at: string // ISO datetime string
  ends_at: string | null // ISO datetime string
  is_all_day: boolean
  venue_id: string | null
  categories: string[]
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
  enrichment_status: EnrichmentStatus
  enrichment_error: string | null
  enriched_at: string | null
  created_at: string
  updated_at: string
}

// Event with venue details (from view)
export interface EventWithVenue extends Event {
  venue_name: string | null
  venue_neighborhood: Neighborhood | null
  venue_address: string | null
}

// For inserting new events
export interface EventInsert {
  name: string
  description_es?: string | null
  description_en?: string | null
  starts_at: string
  ends_at?: string | null
  is_all_day?: boolean
  venue_id?: string | null
  categories?: string[]
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
  enrichment_status?: EnrichmentStatus
  enrichment_error?: string | null
  enriched_at?: string | null
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
  isFree?: boolean
  maxPrice?: number
  minAge?: number
  status?: EventStatus
}

// Content block types for Claude API messages
export type TextBlock = { type: 'text'; text: string }

// Tool input types for the agent - corresponds to the tool definitions in agent.ts
export interface SearchEventsToolInput {
  /** Natural language search query for semantic matching */
  query?: string
  /** Event categories to filter by */
  categories?: string[]
  /** Vibe/mood descriptors for the search */
  vibes?: string[]
  /** Buenos Aires neighborhoods to filter by */
  neighborhoods?: string[]
  /** Buenos Aires neighborhood to filter by (single) - for backwards compatibility */
  neighborhood?: string
  /** Start date filter (ISO string) */
  dateFrom?: string
  /** End date filter (ISO string) */
  dateTo?: string
  /** Minimum price in ARS */
  priceMin?: number
  /** Maximum price in ARS */
  priceMax?: number
  /** Set to true to only show free events */
  isFree?: boolean
  /** Maximum price in ARS - alias for priceMax for backwards compatibility */
  maxPrice?: number
  /** Time period filter */
  timeFilter?: 'tonight' | 'tomorrow' | 'weekend' | 'week'
  /** Maximum number of events to return */
  limit?: number
}

export interface GetVenueDetailsToolInput {
  /** The venue ID (if known from a previous event search) */
  venueId?: string
  /** The name of the venue to search for */
  venueName?: string
}

// Discriminated union for type-safe tool use blocks
export type SearchEventsToolUseBlock = {
  type: 'tool_use'
  id: string
  name: 'search_events'
  input: SearchEventsToolInput
}

export type GetVenueDetailsToolUseBlock = {
  type: 'tool_use'
  id: string
  name: 'get_venue_details'
  input: GetVenueDetailsToolInput
}

export type ToolUseBlock = SearchEventsToolUseBlock | GetVenueDetailsToolUseBlock

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
  suggestions?: RefinementSuggestion[]
  timestamp: Date
  isStreaming?: boolean
}

export interface ChatState {
  messages: ChatMessage[]
  apiHistory: APIMessage[] // Full API history for Claude
  isLoading: boolean
}

// Refinement suggestion for quick search refinement
export interface RefinementSuggestion {
  id: string
  label: string
  prompt: string
  icon?: string
  type: 'time' | 'price' | 'category' | 'neighborhood' | 'broader'
}

// Streaming event types
export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'events'; data: EventWithVenue[] }
  | { type: 'suggestions'; data: RefinementSuggestion[] }
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

// User roles
export type UserRole = 'admin' | 'user'

// Supported locales
export type Locale = 'es' | 'en'

// User profile from profiles table
export interface Profile {
  id: string
  email: string
  display_name: string | null
  role: UserRole
  locale: Locale | null
  created_at: string
  updated_at: string
}

// Saved event record
export interface SavedEvent {
  id: string
  user_id: string
  event_id: string
  created_at: string
}

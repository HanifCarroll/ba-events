import type { RecommendationFraming } from './recommendation-framing.ts'

import type { EventFacets } from '#shared/lib/search-facets.ts'

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
export const EVENT_STATUSES = ['scheduled', 'canceled', 'postponed', 'past', 'pending_review'] as const

export type EventStatus = (typeof EVENT_STATUSES)[number]

// Enrichment status (for both events and venues)
export const ENRICHMENT_STATUSES = ['pending', 'in_progress', 'completed', 'failed', 'skipped'] as const

export type EnrichmentStatus = (typeof ENRICHMENT_STATUSES)[number]

// Address check status (for AI venue name analysis)
export const ADDRESS_CHECK_STATUSES = ['pending', 'flagged', 'confirmed_venue', 'not_flagged'] as const

export type AddressCheckStatus = (typeof ADDRESS_CHECK_STATUSES)[number]

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
  address_check_status: AddressCheckStatus
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

// Database event record
export interface Event {
  id: string
  name: string
  description_es: string | null // Spanish description (primary, used for embedding)
  description_en: string | null // English description (for display)
  description_display_es: string | null // Spanish display text (paragraph-preserving)
  description_display_en: string | null // English display text (paragraph-preserving)
  description_summary_es: string | null // Spanish short summary for cards
  description_summary_en: string | null // English short summary for cards
  starts_at: string // ISO datetime string
  ends_at: string | null // ISO datetime string
  is_all_day: boolean
  time_tba: boolean // True when the date is known but the source time could not be verified
  venue_id: string | null
  categories: string[]
  price: number | null // in ARS
  is_free: boolean
  min_age: number | null // Minimum age required, null means all ages
  image_url: string | null
  image_width?: number | null
  image_height?: number | null
  link: string | null
  ticket_url: string | null
  source: string
  external_id: string | null // ID from external source for deduplication
  status: EventStatus
  location_hidden: boolean // True if address is hidden until registration (e.g., Luma)
  location_tba: boolean // True if venue is TBA or varies per event instance
  description_unavailable: boolean // True if no description exists on source page
  embedding?: number[]
  enrichment_status: EnrichmentStatus
  enrichment_error: string | null
  enriched_at: string | null
  facets: EventFacets
  created_at: string
  updated_at: string
}

// Event with venue details (from view)
export interface EventWithVenue extends Event {
  venue_name: string | null
  venue_neighborhood: Neighborhood | null
  venue_address: string | null
}

// Event payload safe to send to chat clients and persist in chat attachments.
// Embeddings are internal search infrastructure and must not cross this boundary.
export type ChatEventPayload = Omit<EventWithVenue, 'embedding'> & {
  /** Tri-state saved marker applied by the agent turn (true|false|null). */
  saved?: boolean | null
}

// For inserting new events
export interface EventInsert {
  name: string
  description_es?: string | null
  description_en?: string | null
  description_display_es?: string | null
  description_display_en?: string | null
  description_summary_es?: string | null
  description_summary_en?: string | null
  starts_at: string
  ends_at?: string | null
  is_all_day?: boolean
  time_tba?: boolean
  venue_id?: string | null
  categories?: string[]
  price?: number | null
  is_free?: boolean
  min_age?: number | null
  image_url?: string | null
  image_width?: number | null
  image_height?: number | null
  link?: string | null
  ticket_url?: string | null
  source: string
  external_id?: string | null
  status?: EventStatus
  location_hidden?: boolean
  location_tba?: boolean
  description_unavailable?: boolean
  embedding?: number[]
  enrichment_status?: EnrichmentStatus
  enrichment_error?: string | null
  enriched_at?: string | null
  facets?: EventFacets
  /** Full search document (title + descriptions + facets + venue + cost). */
  search_document?: string | null
  /** Schema version of the embedding/search_document. */
  embedding_version?: number
}

// Filters for querying events
export interface EventFilters {
  startsAfter?: string // ISO datetime
  startsBefore?: string // ISO datetime
  neighborhoods?: Neighborhood[]
  venueIds?: string[]
  categories?: string[]
  isFree?: boolean
  maxPrice?: number
  minAge?: number
  status?: EventStatus
  /** Closed facet genres to hard-exclude (events whose facets.genres overlap are dropped). */
  avoidGenres?: string[]
}

// Directions data for Maps links
export interface DirectionsData {
  venueName: string
  address: string
  mapsUrl: string
  eventName?: string
  /** Identity of the event the directions were resolved for (if any). */
  eventId?: string
  /** Identity of the venue the directions were resolved for (if any). */
  venueId?: string
}

export type ChatStreamStatusPhase =
  | 'thinking'
  | 'persisting'
  | 'done'
  | 'error'

export interface ChatStreamStatusData {
  phase: ChatStreamStatusPhase
  requestId: string
  assistantMessageId?: string
  timestamp: string
}

// Chat message types (for UI display)
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string // Display text
  events?: ChatEventPayload[]
  suggestions?: RefinementSuggestion[]
  directions?: DirectionsData
  venue?: VenueDetailsData
  operations?: OperationReceipt[]
  recommendationNextStep?: string
  /** Bounded fixed-template clarification questions (clarification kind). */
  clarificationQuestions?: ClarificationQuestion[]
  timestamp: Date
  isStreaming?: boolean
}

export interface ChatState {
  messages: ChatMessage[]
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
  planned_at: string | null
}

export interface SavedEventWithDetails extends EventWithVenue {
  saved_at: string
}

/**
 * Result of the bounded saved-membership query. `complete` means the full
 * membership for the requested ids is known — an absent id is `saved:false`,
 * and an empty authenticated id set is `complete` with an empty `savedIds`
 * (never `unavailable`). `unavailable` means the query could not run
 * (unauthenticated or an error) and every requested id must be treated as
 * unknown.
 */
export type SavedMembershipResult =
  | { status: 'complete'; savedIds: Set<string> }
  | { status: 'unavailable' }

// Import blocklist types
export const BLOCKLIST_TARGET_FIELDS = ['event_name', 'venue_name'] as const
export type BlocklistTargetField = (typeof BLOCKLIST_TARGET_FIELDS)[number]

export const BLOCKLIST_SOURCES = [
  'passline',
  'eventbrite',
  'ba_tourism',
  'meetup',
  'luma',
  'venti',
  'all',
] as const
export type BlocklistSource = (typeof BLOCKLIST_SOURCES)[number]

export interface ImportBlocklistEntry {
  id: string
  pattern: string
  target_field: BlocklistTargetField
  source: BlocklistSource
  reason: string | null
  created_at: string
  updated_at: string
}

export interface ImportBlocklistEntryInsert {
  pattern: string
  target_field: BlocklistTargetField
  source: BlocklistSource
  reason?: string | null
}

export type ImportBlocklistEntryUpdate = Partial<ImportBlocklistEntryInsert>

// Scrape run status
export const SCRAPE_RUN_STATUSES = ['running', 'completed', 'failed', 'partial'] as const
export type ScrapeRunStatus = (typeof SCRAPE_RUN_STATUSES)[number]

// Scrape run sources
export const SCRAPE_RUN_SOURCES = [
  'passline',
  'eventbrite',
  'ba-tourism',
  'meetup',
  'luma',
  'venti',
  'all',
] as const
export type ScrapeRunSource = (typeof SCRAPE_RUN_SOURCES)[number]

// JSON type for JSONB fields
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

// Scrape run record from database
export interface ScrapeRun {
  id: string
  source: ScrapeRunSource
  status: ScrapeRunStatus
  trigger_id: string | null
  started_at: string
  completed_at: string | null
  events_fetched: number
  events_inserted: number
  events_updated: number
  events_skipped: number
  venues_matched: number
  venues_auto_created: number
  venues_queued_review: number
  enrichments_completed: number
  enrichments_failed: number
  error_message: string | null
  error_details: Json | null
  metadata: Json | null
  created_at: string
}

// Venue review queue status
export const VENUE_REVIEW_STATUSES = ['pending', 'approved', 'rejected', 'merged'] as const
export type VenueReviewStatus = (typeof VENUE_REVIEW_STATUSES)[number]

// Venue review queue record from database
export interface VenueReviewQueue {
  id: string
  scrape_run_id: string | null
  source: string
  source_venue_name: string
  source_address: string | null
  source_coordinates: { lat: number; lng: number } | null
  source_event_ids: string[]
  best_match_venue_id: string | null
  match_confidence: number | null
  status: VenueReviewStatus
  reviewed_at: string | null
  reviewed_by: string | null
  final_venue_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

// Extended venue review with related data
export interface VenueReviewQueueWithDetails extends VenueReviewQueue {
  best_match_venue_name: string | null
  final_venue_name: string | null
  reviewed_by_email: string | null
}

// =============================================================================
// CONCIERGE UX TYPES
// =============================================================================

/**
 * A recommendation with Claude's commentary and tips.
 * Used for the unified recommendation card in Phase 2.
 */
export interface Recommendation {
  event: EventWithVenue
  /** Claude's personalized take on why this event fits */
  commentary: string
  /** Practical tips like "get there around 10pm" */
  tips: string[]
  /** How well this matches the query (0-100) */
  matchScore?: number
  /** Context-aware refinement options for this recommendation */
  refinements: RefinementOption[]
}

/**
 * A contextual refinement option shown below a recommendation.
 * Different from RefinementSuggestion - these are per-recommendation.
 */
export interface RefinementOption {
  id: string
  /** Display text like "More upscale" or "Different area" */
  label: string
  /** The prompt to send as a follow-up message */
  prompt: string
  /** Lucide icon name */
  icon?: string
  /** Type of refinement for grouping/styling */
  type?: 'vibe' | 'price' | 'neighborhood' | 'venue' | 'time' | 'alternatives'
}

/**
 * Extended ChatMessage for concierge UX.
 * Adds support for recommendations and decision state.
 */
export interface ConciergeMessage extends ChatMessage {
  /** Primary recommendation with commentary (single recommendation mode) */
  recommendation?: Recommendation
  /** Alternative recommendations if user asked for options */
  alternatives?: Recommendation[]
  /** User has confirmed this recommendation */
  isDecision?: boolean
}

// =============================================================================
// CANONICAL CHAT RESPONSE (v5)
// =============================================================================

/**
 * Response contract version. The ToolLoopAgent keeps the v5 wire shape;
 * mutation/stage fields remain only for non-destructive historical reads.
 */
export const CHAT_CONTRACT_VERSION = 5 as const

export type ResponseKind =
  | 'recommendations'
  | 'event_details'
  | 'saved_events'
  | 'directions'
  | 'venue_details'
  | 'mutation_result'
  | 'clarification'
  | 'no_results'
  | 'out_of_scope'
  | 'error'

/**
 * Closed compatibility/classification keys for response kinds and historical UI
 * rendering. New turns may use a model-written text value, which must be
 * grounded in successful tool results or server-rehydrated active facts. The
 * key remains structured UI metadata, not a prose generator.
 */
export const MESSAGE_KEYS = [
  'recommendations',
  'recommendations_pick',
  'recommendations_mismatch',
  'event_details',
  'saved_events',
  'directions',
  'venue_details',
  'clarification',
  'no_results',
  'out_of_scope',
  'share_guidance',
  'error',
  'mutation_applied',
  'mutation_already_applied',
  'mutation_unauthenticated',
  'mutation_not_found',
  'mutation_failed',
  'mutation_mixed',
  'partial_results',
  'pinned_event_unavailable',
  'use_save_control',
  'use_unsave_control',
  'login_required',
] as const
export type MessageKey = (typeof MESSAGE_KEYS)[number]

/** The legacy v4 mutation lead key, replaced in v5 by outcome-aware leads. */
export const LEGACY_MUTATION_RESULT_KEY = 'mutation_result' as const

/** Closed set of clarification question templates (sanitized, no artifact facts). */
export const CLARIFICATION_KEYS = [
  'which_event',
  'which_day',
  'which_time',
  'which_neighborhood',
  'which_category',
  'which_venue',
  'budget',
] as const
export type ClarificationKey = (typeof CLARIFICATION_KEYS)[number]

/** A bounded, fixed-template clarification question. */
export interface ClarificationQuestion {
  key: ClarificationKey
  /** Localized label materialized server-side from the key. */
  label: string
}

/**
 * Tri-state saved marker. `true` = saved, `false` = not saved, `null` = unknown.
 * Search/details default null; saved-list and authoritative membership can set
 * true/false. Historical adapters preserve old persisted values.
 */
export type SavedState = boolean | null

/**
 * An event as carried in a canonical v5 response. `saved` is always an explicit
 * tri-state marker. The ordinary DB/search `ChatEventPayload` keeps `saved`
 * optional (absent) because those records predate the tri-state marker.
 */
export type CanonicalChatEventPayload = ChatEventPayload & {
  saved: SavedState
}

/**
 * Typed fallback reasons retained for historical v5 rows. Current agent turns
 * reuse planner_error for provider/loop failures.
 */
export const FALLBACK_REASONS = [
  'planner_error',
  'finalizer_error',
  'invalid_schema',
  'unknown_event_id',
  'invalid_source_tool_call',
  'inconsistent_response_kind',
  'missing_required_artifact',
  'duplicate_event_id',
  'over_limit',
  'pinned_substitution',
  'invalid_directions_ref',
  'invalid_venue_ref',
  'invalid_mutation_ref',
  'no_results',
  'superseded_source',
  'rejected_source',
  'unrelated_directions_ref',
  'unrelated_venue_ref',
  'unrelated_event_details_ref',
  'invalid_empty_source',
  'invalid_message_key',
  'invalid_clarification',
  'mutation_target_mismatch',
  'ambiguous_mutation_target',
  'ambiguous_turn_target',
] as const

export type FallbackReason = (typeof FALLBACK_REASONS)[number]

export type MutationOutcome =
  | 'applied'
  | 'already_applied'
  | 'denied'
  | 'unauthenticated'
  | 'not_found'
  | 'failed'

/** Historical save/unsave receipt retained for persisted-response adapters. */
export interface OperationReceipt {
  toolCallId: string
  toolName: 'save_event' | 'unsave_event'
  eventId: string
  outcome: MutationOutcome
  message: string
}

// ============================================================================
// PINNED-EVENT MODE (v5)
// ============================================================================

/**
 * Typed pinned-event resolution. A requested pin that cannot resolve to a
 * displayable event is a typed failure — never a silent fallback to discovery.
 */
export type PinResolution =
  | { requested: false }
  | { requested: true; status: 'resolved'; eventId: string; venueId: string | null }
  | {
      requested: true
      status: 'invalid' | 'missing' | 'unavailable'
      eventIdHint: string | null
    }

/** Where a canonical response's provenance came from. */
export type ProvenanceOrigin = 'validated' | 'fallback' | 'legacy_unknown'

export interface CanonicalProvenance {
  /** Tool calls that produced the selected events, deduped, in display order. */
  sourceToolCallIds: string[]
  /** Tool calls that produced the attached direction reference, deduped. */
  directionToolCallIds: string[]
  /** Tool calls that produced the attached venue reference, deduped. */
  venueToolCallIds: string[]
  /** Compatibility-only: historical mutation receipts; always empty on new turns. */
  mutationToolCallIds: string[]
  /** Tool calls that produced the selected suggestion source, deduped. */
  suggestionToolCallIds: string[]
  /** Empty-source tool call ids that ground a no_results response, deduped. */
  emptySourceToolCallIds: string[]
  /** Compatibility-only retained-source ids; always empty on new turns. */
  retainedSourceToolCallIds: string[]
  /** Compatibility-only stage ids; always empty on new turns. */
  stageIds: string[]
  /** Every search call attempted by the bounded agent loop, in execution order. */
  searchAttemptToolCallIds: string[]
  /** Compatibility-only partial-stage marker; always false on new turns. */
  searchIncomplete: boolean
  origin: ProvenanceOrigin
  fallbackUsed: boolean
  fallbackReason: FallbackReason | null
}

/** Venue details materialized from a successful get_venue_details call. */
export interface VenueDetailsData {
  venueId: string | null
  venueName: string
  neighborhood: string | null
  address: string | null
  website: string | null
  instagram: string | null
}

/**
 * The single authoritative assistant response for a chat turn (v5).
 * `text` is the agent's visible prose; structured artifacts never come from
 * that prose. `messageKey`,
 * `clarificationQuestions`, and every provenance array are required, and
 * legacy adapters fill compatibility defaults.
 */
export interface CanonicalChatResponse {
  contractVersion: typeof CHAT_CONTRACT_VERSION
  requestId: string
  kind: ResponseKind
  /** Compatibility/UI classification key; not the source of `text`. */
  messageKey: MessageKey
  text: string
  /** AI-authored framing only; event facts remain in `events` and other artifacts. */
  framing?: RecommendationFraming
  events: CanonicalChatEventPayload[]
  directions: DirectionsData | null
  venue: VenueDetailsData | null
  operations: OperationReceipt[]
  suggestions: RefinementSuggestion[]
  /** Bounded fixed-template clarification questions (clarification kind). */
  clarificationQuestions: ClarificationQuestion[]
  provenance: CanonicalProvenance
}

// =============================================================================
// CONVERSATION HISTORY TYPES
// =============================================================================

/** Message role for conversation messages */
export type MessageRole = 'user' | 'assistant' | 'system'

/** Tool call captured in an assistant execution trace step */
export interface MessageExecutionToolCall {
  toolCallId: string
  toolName: string
  input: Json | null
}

/** Tool result captured in an assistant execution trace step */
export interface MessageExecutionToolResult {
  toolCallId: string
  toolName: string
  input: Json | null
  output: Json | null
  success: boolean
}

export interface MessageExecutionStep {
  stepIndex: number
  stepType: 'initial' | 'continue' | 'tool-result' | 'unknown'
  text: string
  reasoning?: string
  finishReason: string
  toolCalls: MessageExecutionToolCall[]
  toolResults: MessageExecutionToolResult[]
}

/** Attached data stored with assistant messages */
export interface MessageAttachedData {
  events?: ChatEventPayload[]
  suggestions?: RefinementSuggestion[]
  directions?: DirectionsData
  /**
   * Canonical response payload at the storage boundary. Stored verbatim and
   * authoritative on reload, but its exact version/shape depends on when the
   * row was written (v2 has no canonical; v3-v5 store versioned shapes).
   * Kept `unknown` so the storage layer never lies about legacy JSON — use the
   * version-aware adapters in `canonical.ts` to produce a strict v5 render shape.
   */
  canonical?: unknown
}

export type ConversationChannel = 'web' | 'telegram'

/** Database record for a conversation */
export interface Conversation {
  id: string
  user_id: string | null
  channel: ConversationChannel
  external_identity_hash: string | null
  title: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  metadata: Record<string, Json>
}

/** For inserting a new conversation */
export interface ConversationInsert {
  id?: string
  user_id?: string | null
  channel?: ConversationChannel
  external_identity_hash?: string | null
  title?: string
  metadata?: Record<string, Json>
}

/** For updating a conversation */
export type ConversationUpdate = Partial<
  Omit<ConversationInsert, 'user_id' | 'channel' | 'external_identity_hash'>
> & {
  deleted_at?: string | null
}

/** Database record for a message */
export interface Message {
  id: string
  conversation_id: string
  parent_id: string | null // Assistant messages link to their triggering user message
  client_message_id: string | null
  role: MessageRole
  content: string // Legacy-visible mirror for rollback compatibility
  visible_content: string
  execution_trace: MessageExecutionStep[]
  response_contract_version: number
  attached_data: MessageAttachedData
  created_at: string
  sequence_number: number
  turn_index: number
}

/** For inserting a new message */
export interface MessageInsert {
  conversation_id: string
  parent_id?: string | null
  client_message_id?: string | null
  role: MessageRole
  content: string
  visible_content?: string
  execution_trace?: MessageExecutionStep[]
  response_contract_version?: number
  attached_data?: MessageAttachedData
  sequence_number?: number
  turn_index?: number
}

/** Lightweight conversation for list views */
export interface ConversationListItem {
  id: string
  title: string
  updated_at: string
  /** Preview of the last message (optional, for display) */
  preview?: string
}

/** Conversation with its messages for display */
export interface ConversationWithMessages extends Conversation {
  messages: Message[]
}

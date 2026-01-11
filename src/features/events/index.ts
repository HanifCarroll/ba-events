// Events Feature - Public API
// This is the public interface for the events feature.
// Import from '@/features/events' instead of reaching into internal modules.

// API (Server Functions)
export {
  listEvents,
  listEventsPaginated,
  listAllEventsAdmin,
  listActiveEventsAdmin,
  listPastEventsAdmin,
  getEventTabCountsAction,
  getEventAction,
  createEventAction,
  updateEventAction,
  deleteEventAction,
  bulkCreateEventsAction,
  bulkUpdateEventStatusAction,
  bulkDeleteEventsAction,
  countPastEventsAction,
  markPastEventsAction,
} from './api/crud'

export {
  enrichEventDescriptionsAction,
  getEventsWithoutDescriptions,
  regenerateEmbeddingsAction,
  updateEventDescriptionsAction,
  getRecentlyImportedPendingEventsAction,
  getPendingEnrichmentCountsAction,
  getAllPendingEventsAction,
  getNeedsAttentionBreakdownAction,
  resetFailedEnrichmentsAction,
  getEventsNeedingVenueOnlyAction,
  enrichPasslineDescriptionsAction,
  enrichPasslineDescriptionsWithPlaywrightAction,
  getPasslineEventsNeedingDescriptionsAction,
  type NeedsAttentionBreakdown,
  type PasslineDescriptionEnrichProgress,
  type PasslineDescriptionEnrichComplete,
  type PasslineDescriptionEnrichUpdate,
} from './api/enrichment'

export {
  getPendingEventsAction,
  approveEventAction,
  rejectEventAction,
} from './api/moderation'

export { getAdminStats } from './api/stats'

// Hooks
export { useCreateEvent, useUpdateEvent, useDeleteEvent } from './hooks/useEventMutations'
export { useBulkActions, type BulkActionType, type UseBulkActionsReturn } from './hooks/useBulkActions'
export { useDescriptionEnrichment, type EnrichStep } from './hooks/useDescriptionEnrichment'
export { useBackgroundEnrichment } from './hooks/useBackgroundEnrichment'
export { useLumaDescriptionEnrichment } from './hooks/useLumaDescriptionEnrichment'
export { usePasslineDescriptionEnrichment } from './hooks/usePasslineDescriptionEnrichment'
export { useUnifiedDescriptionEnrichment } from './hooks/useUnifiedDescriptionEnrichment'
export {
  getEnrichmentMethod,
  getEnrichmentStrategy,
  groupEventsByEnrichmentMethod,
  type DescriptionEnrichmentMethod,
} from './hooks/description-enrichment-strategies'
export { useSingleEventActions } from './hooks/useSingleEventActions'
export { useMarkPastEvents } from './hooks/useMarkPastEvents'
export {
  useEventsPaginated,
  type EventSearchParams,
  type EventTab,
  type UseEventsPaginatedOptions,
  type UseEventsPaginatedReturn,
} from './hooks/useEventsPaginated'

// Types
export type {
  EmbeddingProgress,
  EmbeddingComplete,
  EmbeddingUpdate,
  DescriptionUpdateProgress,
  DescriptionUpdateComplete,
  DescriptionUpdateUpdate,
  DescriptionEnrichProgress,
  DescriptionEnrichComplete,
  DescriptionEnrichUpdate,
} from './api/streaming-types'

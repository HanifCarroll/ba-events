// Events Feature - Public API
// This is the public interface for the events feature.
// Import from '@/features/events' instead of reaching into internal modules.

// API (Server Functions)
export {
  listEvents,
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
} from './api/enrichment'

export {
  getPendingEventsAction,
  approveEventAction,
  rejectEventAction,
} from './api/moderation'

export { getAdminStats } from './api/stats'

// Hooks
export { useCreateEvent, useUpdateEvent, useDeleteEvent } from './hooks/useEventMutations'
export {
  useEventFiltering,
  type EventTab,
  type DataGapType,
  type CompletenessFilter,
  type VenueOption,
  type DataGapCounts,
  type TabCounts,
  type UseEventFilteringOptions,
} from './hooks/useEventFiltering'
export { useBulkActions, type BulkActionType, type UseBulkActionsReturn } from './hooks/useBulkActions'
export { useDescriptionEnrichment, type EnrichStep } from './hooks/useDescriptionEnrichment'
export { useBackgroundEnrichment } from './hooks/useBackgroundEnrichment'
export { useLumaDescriptionEnrichment } from './hooks/useLumaDescriptionEnrichment'
export { useEmbeddingRegeneration } from './hooks/useEmbeddingRegeneration'
export { useSingleEventActions } from './hooks/useSingleEventActions'
export { useMarkPastEvents } from './hooks/useMarkPastEvents'
export { useEventAdmin } from './hooks/useEventAdmin'

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

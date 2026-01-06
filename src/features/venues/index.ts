// Venues Feature - Public API
// This is the public interface for the venues feature.
// Import from '@/features/venues' instead of reaching into internal modules.

// API (Server Functions)
export {
  listVenues,
  getVenue,
  getVenuesForSelect,
  createVenueAction,
  updateVenueAction,
  deleteVenueAction,
  bulkCreateVenuesAction,
  bulkDeleteVenuesAction,
} from './api/crud'

export {
  getVenuesNeedingEnrichmentAction,
  enrichVenuesWithNominatimAction,
  mapNominatimNeighborhood,
  getRecentlyCreatedPendingVenuesAction,
  getAllPendingVenuesAction,
  lookupNeighborhoodsAction,
  type VenueEnrichmentInput,
  type VenueEnrichmentOutput,
  type VenueEnrichmentProgress,
  type VenueEnrichmentComplete,
  type VenueEnrichmentUpdate,
} from './api/enrichment'

export {
  getDuplicateVenueCandidatesAction,
  detectAddressLikeNamesAction,
  mergeVenuesAction,
  getVenueEventCountsAction,
  getVenueEventsAction,
  dismissDuplicatePairAction,
  getDismissedDuplicatesAction,
  restoreDismissedPairAction,
  type VenueDuplicatePair,
  type MergeVenuesResult,
  type VenueEventPreview,
  type DismissedDuplicate,
  type AddressNameResult,
  type AddressDetectionProgress,
  type AddressDetectionComplete,
  type AddressDetectionUpdate,
} from './api/review'

// Hooks
export { useCreateVenue, useUpdateVenue, useDeleteVenue } from './hooks/useVenueMutations'
export { useVenueBulkActions, type VenueBulkActionType, type UseVenueBulkActionsReturn } from './hooks/useVenueBulkActions'
export { useVenueReview, type ReviewTab, type DuplicateGroup, type AddressLikeVenue } from './hooks/useVenueReview'
export { useVenueNominatimEnrichment, type VenueEventsMap } from './hooks/useVenueNominatimEnrichment'
export { useVenueEnrichment } from './hooks/useVenueEnrichment'

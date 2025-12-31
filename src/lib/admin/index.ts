// Re-export all admin modules for convenience

// Utils (note: requireAdminAccess is not exported - it's server-only and used internally)
export { mapToNeighborhood } from './utils'

// Stats
export { getAdminStats } from './stats'

// Venues
export {
  listVenues,
  getVenue,
  getVenuesForSelect,
  createVenueAction,
  updateVenueAction,
  deleteVenueAction,
  bulkCreateVenuesAction,
  bulkDeleteVenuesAction,
} from './venues'

// Events
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
} from './events'

// Moderation
export {
  getPendingEventsAction,
  approveEventAction,
  rejectEventAction,
} from './moderation'

// Enrichment
export {
  enrichEventDescriptionsAction,
  getEventsWithoutDescriptions,
  updateEventDescriptionsAction,
  regenerateEmbeddingsAction,
  type EmbeddingProgress,
  type EmbeddingComplete,
  type EmbeddingUpdate,
  type DescriptionUpdateProgress,
  type DescriptionUpdateComplete,
  type DescriptionUpdateUpdate,
  type DescriptionEnrichProgress,
  type DescriptionEnrichComplete,
  type DescriptionEnrichUpdate,
} from './enrichment'

// Passline
export {
  processPasslineEventsAction,
  importPasslineEventsBatchAction,
  enrichPasslineVenuesAction,
  type PasslinePreviewEvent,
  type PasslineEvent,
} from './sources/passline'

// Eventbrite
export {
  fetchEventbriteEventsAction,
  processEventbriteEventsAction,
  importEventbriteEventsBatchAction,
  getEventbriteEventsNeedingEnrichmentAction,
  enrichEventbriteEventsAction,
  enrichEventbriteVenuesAction,
  type EventbritePreviewEvent,
  type EventbriteEvent,
  type EventbriteEnrichmentInput,
  type ImportProgress as EventbriteImportProgress,
  type ImportComplete as EventbriteImportComplete,
  type ImportUpdate as EventbriteImportUpdate,
  type VenueEnrichProgress as EventbriteVenueEnrichProgress,
  type VenueEnrichComplete as EventbriteVenueEnrichComplete,
  type VenueEnrichUpdate as EventbriteVenueEnrichUpdate,
} from './sources/eventbrite'

// BA Tourism
export {
  fetchBATourismEventsAction,
  importBATourismEventsBatchAction,
  getBATourismEventsNeedingEnrichmentAction,
  enrichBATourismVenuesAction,
  type BATourismPreviewEvent,
  type BATourismEvent,
  type WeekContext,
  type BATourismEnrichmentInput,
  type ImportProgress as BATourismImportProgress,
  type ImportComplete as BATourismImportComplete,
  type ImportUpdate as BATourismImportUpdate,
  type VenueEnrichProgress as BATourismVenueEnrichProgress,
  type VenueEnrichComplete as BATourismVenueEnrichComplete,
  type VenueEnrichUpdate as BATourismVenueEnrichUpdate,
} from './sources/ba-tourism'

// Meetup
export {
  processMeetupEventsAction,
  fetchMeetupEventsAction,
  importMeetupEventsBatchAction,
  getMeetupEventsNeedingEnrichmentAction,
  enrichMeetupVenuesAction,
  type MeetupPreviewEvent,
  type MeetupEvent,
  type MeetupEnrichmentInput,
  type ImportProgress as MeetupImportProgress,
  type ImportComplete as MeetupImportComplete,
  type ImportUpdate as MeetupImportUpdate,
  type VenueEnrichProgress as MeetupVenueEnrichProgress,
  type VenueEnrichComplete as MeetupVenueEnrichComplete,
  type VenueEnrichUpdate as MeetupVenueEnrichUpdate,
} from './sources/meetup'

// Venue Review
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
  type AddressNameResult,
  type MergeVenuesResult,
  type VenueEventPreview,
  type DismissedDuplicate,
  type AddressDetectionProgress,
  type AddressDetectionComplete,
  type AddressDetectionUpdate,
} from './venue-review'

// Venue Enrichment (Nominatim)
export {
  getVenuesNeedingEnrichmentAction,
  enrichVenuesWithNominatimAction,
  mapNominatimNeighborhood,
  type VenueEnrichmentInput,
  type VenueEnrichmentOutput,
  type VenueEnrichmentProgress,
  type VenueEnrichmentComplete,
  type VenueEnrichmentUpdate,
} from './venue-enrichment'

// Shared Streaming Types (base types without source-specific prefixes)
export {
  type ImportProgress,
  type ImportComplete,
  type ImportUpdate,
  type VenueEnrichProgress,
  type VenueEnrichComplete,
  type VenueEnrichUpdate,
  type NominatimEnrichProgress,
  type NominatimEnrichComplete,
  type NominatimEnrichUpdate,
} from './streaming-types'

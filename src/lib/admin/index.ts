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
  type EventbriteEnrichmentOutput,
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
  type BATourismEnrichmentOutput,
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
  type MeetupEnrichmentOutput,
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
} from './venue-review'

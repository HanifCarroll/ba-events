// Import Feature - Public API
// This is the public interface for the import feature.
// Import from '@/features/import' instead of reaching into internal modules.

// Passline imports
export {
  processPasslineEventsAction,
  importPasslineEventsBatchAction,
  enrichPasslineVenuesAction,
  type PasslinePreviewEvent,
  type PasslineEvent,
  type VenueEnrichComplete as PasslineVenueEnrichComplete,
  type ImportComplete as PasslineImportComplete,
} from './api/passline'

// Eventbrite imports
export {
  fetchEventbriteEventsAction,
  processEventbriteEventsAction,
  importEventbriteEventsBatchAction,
  getEventbriteEventsNeedingEnrichmentAction,
  enrichEventbriteEventsAction,
  enrichEventbriteVenuesAction,
  type EventbritePreviewEvent,
  type EventbriteEnrichmentInput,
  type EventbriteEnrichmentOutput,
  type VenueEnrichComplete as EventbriteVenueEnrichComplete,
  type ImportComplete as EventbriteImportComplete,
} from './api/eventbrite'

// BA Tourism imports
export {
  fetchBATourismEventsAction,
  importBATourismEventsBatchAction,
  getBATourismEventsNeedingEnrichmentAction,
  enrichBATourismVenuesAction,
  type BATourismPreviewEvent,
  type BATourismEnrichmentInput,
  type VenueEnrichComplete as BATourismVenueEnrichComplete,
  type ImportComplete as BATourismImportComplete,
} from './api/ba-tourism'

// Meetup imports
export {
  processMeetupEventsAction,
  fetchMeetupEventsAction,
  importMeetupEventsBatchAction,
  getMeetupEventsNeedingEnrichmentAction,
  enrichMeetupVenuesAction,
  type MeetupPreviewEvent,
  type MeetupEnrichmentInput,
  type VenueEnrichComplete as MeetupVenueEnrichComplete,
  type ImportComplete as MeetupImportComplete,
} from './api/meetup'

// Luma imports
export {
  fetchLumaEventsAction,
  importLumaEventsBatchAction,
  getLumaEventsNeedingDescriptionEnrichmentAction,
  enrichLumaDescriptionsAction,
  enrichLumaVenuesAction,
  type LumaPreviewEvent,
  type LumaEvent,
  type LumaDescriptionEnrichmentInput,
  type LumaVenueEnrichmentInput,
  type ImportComplete as LumaImportComplete,
  type DescriptionEnrichComplete as LumaDescriptionEnrichComplete,
  type VenueEnrichComplete as LumaVenueEnrichComplete,
} from './api/luma'

// Hooks
export { useImportWizard, type ImportSource, type WizardStep, type BatchProgress } from './hooks/useImportWizard'
export {
  useAutoEnrichment,
  type AutoEnrichmentState,
  type EventToEnrich,
  type VenueToEnrich,
} from './hooks/useAutoEnrichment'
export {
  useTriggerEnrichment,
  type EnrichmentProgress,
  type EnrichmentResult,
  type EnrichmentStatus,
  type TriggerEnrichmentState,
} from './hooks/useTriggerEnrichment'

// Trigger.dev enrichment API
export {
  triggerEventEnrichmentAction,
  getEnrichmentJobStatusAction,
  getActiveEnrichmentJobAction,
  type TriggerEnrichmentResult,
  type EnrichmentJobStatus,
  type ActiveEnrichmentJob,
} from './api/trigger-enrichment'

// Duplicate detection types
export { type DuplicateInfo, type FieldDiff } from './api/duplicate-detection'

// Scrapers - only export types and client-side utilities
export { type PasslineEvent as PasslineEventRaw } from './scrapers/passline'
export { type EventbriteEvent } from './scrapers/eventbrite'
export { type BATourismEvent, type WeekContext } from './scrapers/ba-tourism'
export { type MeetupEvent } from './scrapers/meetup'
export { type VenueMatchResult } from './scrapers/venue-matcher'

// Client-side scraper for Passline (bypasses Cloudflare)
export {
  extractPasslineVenuesBatchClient,
  extractPasslineEventsBatchClient,
  extractPasslineEventInfoClient,
  type PasslineVenueInfo,
  type PasslineEventInfo,
  type PasslineEnrichmentResult,
} from './scrapers/passline/client-enrichment'

// Blocklist API
export {
  listBlocklistEntriesAction,
  getBlocklistEntryAction,
  createBlocklistEntryAction,
  updateBlocklistEntryAction,
  deleteBlocklistEntryAction,
  bulkDeleteBlocklistEntriesAction,
} from './api/blocklist'

// Blocklist hooks
export {
  useCreateBlocklistEntry,
  useUpdateBlocklistEntry,
  useDeleteBlocklistEntry,
  useBulkDeleteBlocklistEntries,
} from './hooks/useBlocklistMutations'

// Scrape runs API
export {
  listScrapeRunsAction,
  getScrapeRunAction,
  getLatestScrapeRunsAction,
  getScrapeStatsAction,
  listVenueReviewQueueAction,
  getVenueReviewCountAction,
  approveVenueReviewAction,
  rejectVenueReviewAction,
  mergeVenueReviewAction,
} from './api/scrape-runs'

/** Catalog repository used by importers, venue settlement, enrichment, and scrape auditing. */
import type { EventInsert, ImportBlocklistEntry, BlocklistSource, Venue } from '#shared/lib/types.ts'
import type { ExistingEventData } from '../api/duplicate-detection.ts'
import type { EnrichmentProvenance } from './enrichment-provenance.ts'

/** Columns an import or enrichment writes to `events`. `embedding` is stored in Vectorize. */
export type EventWrite = { [K in keyof EventInsert]?: EventInsert[K] | null } & {
  enrichment_provenance?: EnrichmentProvenance | null
}

export interface VenueWrite {
  name: string
  address: string | null
  neighborhood: string | null
  enrichment_status: 'pending'
  address_check_status: 'pending' | 'flagged' | 'not_flagged'
}

export interface VenueReviewWrite {
  scrape_run_id: string | null
  source: string
  source_venue_name: string
  source_address?: string | null
  source_coordinates?: { lat: number; lng: number } | null
  best_match_venue_id?: string | null
  match_confidence: number
  source_event_ids: string[]
  status: 'pending'
}

export interface VenueReviewSettlement {
  status: 'approved' | 'rejected' | 'merged'
  final_venue_id: string | null
  reviewed_at: string
  reviewed_by: string | null
  notes: string | null
}

/** Pending or failed rows with a link, not canceled or past, not started, from a live source. */
export interface EnrichmentQuery {
  source?: string
  limit?: number
  createdAfter?: string
  statuses?: Array<'pending' | 'failed'>
  /** ISO time; rows that start before it are left out. */
  startsAtFloor: string
  retiredSources: readonly string[]
}

/** What enrichment reads for one event. */
export interface EnrichmentRow {
  id: string
  name: string
  link: string | null
  source: string
  categories?: string[] | null
  venue_id?: string | null
  description_es?: string | null
  description_en?: string | null
  facets?: unknown
  enrichment_status?: 'pending' | 'completed' | 'failed' | 'skipped' | null
  price?: number | null
  is_free?: boolean
  enrichment_provenance?: EnrichmentProvenance | null
}

export interface ScrapeRunPatch {
  status?: 'running' | 'completed' | 'failed' | 'partial'
  completed_at?: string
  error_message?: string | null
  error_details?: unknown
  events_fetched?: number
  events_inserted?: number
  events_updated?: number
  events_skipped?: number
  venues_auto_created?: number
  enrichments_completed?: number
  enrichments_failed?: number
  metadata?: unknown
}

export interface CatalogStore {
  /** Entries for `source` plus those for every source; all entries without one. Newest first. */
  blocklistEntries(source?: BlocklistSource): Promise<ImportBlocklistEntry[]>

  /** Venues with the same `venueNameKey` (venue-identity.ts) as `name`, oldest first, with their event counts. */
  venuesNamed(name: string): Promise<Array<Venue & { event_count: number }>>
  /** The most similar venue name at or above `threshold` (pg_trgm `similarity`), as `find_similar_venue` returns it. */
  similarVenue(name: string, threshold: number): Promise<{ id: string; name: string; similarity: number } | null>
  venueNameAndNeighborhood(id: string): Promise<{ name: string | null; neighborhood: string | null }>
  createVenue(venue: VenueWrite): Promise<Venue>
  queueVenueReview(entry: VenueReviewWrite): Promise<void>
  settleVenueReview(id: string, settlement: VenueReviewSettlement): Promise<void>
  venueReviewEventIds(id: string): Promise<string[]>
  setEventsVenue(eventIds: string[], venueId: string): Promise<void>

  /** Rows of `source` whose `external_id` is in the list, with the fields scraper updates compare. */
  existingEvents(source: string, externalIds: string[]): Promise<ExistingEventData[]>
  insertEvent(event: EventWrite & Pick<EventInsert, 'name' | 'starts_at' | 'source'>): Promise<void>
  updateEvent(id: string, patch: EventWrite): Promise<void>
  eventsNeedingEnrichment(query: EnrichmentQuery): Promise<EnrichmentRow[]>
  countEventsNeedingEnrichment(query: Omit<EnrichmentQuery, 'limit'>): Promise<number>
  /** Every event's id, name, source, and venue name, for the blocklist cleanup. */
  blocklistCandidates(): Promise<Array<{ id: string; name: string | null; source: string; venue_name: string | null }>>
  deleteEvents(ids: string[]): Promise<void>

  createScrapeRun(run: { source: 'all'; status: 'running'; trigger_id: string; metadata: unknown }): Promise<{ id: string; metadata: unknown }>
  /** Applies `patch` to every run still `running` that started before `cutoff`; returns how many. */
  failStaleScrapeRuns(cutoff: string, patch: ScrapeRunPatch): Promise<number>
  /** The run's metadata, or undefined when the run doesn't exist. */
  scrapeRunMetadata(id: string): Promise<unknown>
  updateScrapeRun(id: string, patch: ScrapeRunPatch): Promise<void>
}

/** The D1 catalog env: the `DB` binding (d1.server.ts) plus the `VECTORIZE` index the event vectors live in. */
export interface CatalogEnv { DB?: unknown; VECTORIZE?: unknown }

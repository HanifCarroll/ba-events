/**
 * The catalog repository the importers, venue settlement, enrichment, and the daily-scrape audit write through.
 *
 * Two implementations sit behind it (the backend seam, DECISIONS.md): `supabaseCatalog` runs the same PostgREST
 * queries production has always run, and `d1Catalog` (catalog-store-d1.ts) runs them on D1 and keeps Vectorize in step.
 * `catalogStoreFor(env)` picks D1 only when the env binds `DB`, which production configs don't until the cutover.
 *
 * Every method rejects with an Error when the database does, except where the Supabase implementation keeps an old
 * forgiving read (noted there) so production behaves exactly as before.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventInsert, ImportBlocklistEntry, BlocklistSource, Venue } from '#shared/lib/types.ts'
import type { ExistingEventData } from '../api/duplicate-detection.ts'
import type { EnrichmentProvenance } from './enrichment-provenance.ts'

/** Columns an import or enrichment writes to `events`. `embedding` goes to pgvector on Supabase and Vectorize on D1. */
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

function fail(operation: string, error: { message: string } | null): void {
  if (error) throw new Error(`${operation}: ${error.message}`)
}

const EXISTING_EVENT_COLUMNS = 'id, external_id, name, description_es, description_en, starts_at, ends_at, is_all_day, time_tba, venue_id, categories, price, is_free, min_age, image_url, image_width, image_height, link, ticket_url, status, location_hidden, location_tba, description_unavailable, facets, embedding_version'

/** The PostgREST queries production has always run, behind the catalog interface. */
export function supabaseCatalog(client: SupabaseClient): CatalogStore {
  const enrichmentFilter = <Q extends { in: Function; neq: Function; gte: Function; not: Function; eq: Function }>(base: Q, query: Omit<EnrichmentQuery, 'limit'>): Q => {
    let q = (base as any)
      .in('enrichment_status', query.statuses ?? ['pending', 'failed'])
      .neq('status', 'canceled')
      .neq('status', 'past')
      .gte('starts_at', query.startsAtFloor)
      .not('link', 'is', null)
      .not('source', 'in', `(${query.retiredSources.join(',')})`)
    if (query.source) q = q.eq('source', query.source)
    if (query.createdAfter) q = q.gte('created_at', query.createdAfter)
    return q
  }

  return {
    async blocklistEntries(source) {
      let query = client.from('import_blocklist').select('*').order('created_at', { ascending: false })
      if (source && source !== 'all') query = query.or(`source.eq.${source},source.eq.all`)
      const { data, error } = await query
      if (error) throw error
      return data as ImportBlocklistEntry[]
    },

    async venuesNamed(name) {
      const { data, error } = await client.rpc('venues_named', { p_name: name })
      fail('venues_named', error)
      return ((data ?? []) as Array<{ venue: Venue; event_count: number | string }>)
        .map(row => ({ ...row.venue, event_count: Number(row.event_count) }))
    },

    async similarVenue(name, threshold) {
      const { data, error } = await client.rpc('find_similar_venue', { search_name: name, similarity_threshold: threshold })
      fail('find_similar_venue', error)
      const match = (data as Array<{ id: string; name: string; similarity: number }> | null)?.[0]
      return match ? { id: match.id, name: match.name, similarity: Number(match.similarity) } : null
    },

    async venueNameAndNeighborhood(id) {
      const { data, error } = await client.from('venues').select('name, neighborhood').eq('id', id).maybeSingle()
      // Old behaviour: a failed read gives no venue name rather than failing enrichment.
      if (error) {
        console.error(`[event-enrichment] Failed to fetch venue ${id}:`, error)
        return { name: null, neighborhood: null }
      }
      return { name: data?.name ?? null, neighborhood: data?.neighborhood ?? null }
    },

    async createVenue(venue) {
      const { data, error } = await client.from('venues').insert(venue).select().single()
      if (error) throw new Error(`Failed to create venue: ${error.message}`)
      if (!data) throw new Error('Failed to create venue')
      return data as Venue
    },

    async queueVenueReview(entry) {
      const { error } = await client.from('venue_review_queue').insert(entry)
      fail('venue_review_queue insert', error)
    },

    async settleVenueReview(id, settlement) {
      const { error } = await client.from('venue_review_queue').update(settlement).eq('id', id)
      fail('venue_review_queue update', error)
    },

    async venueReviewEventIds(id) {
      // Old behaviour: a failed read re-points nothing.
      const { data } = await client.from('venue_review_queue').select('source_event_ids').eq('id', id).single()
      return (data?.source_event_ids as string[] | null) ?? []
    },

    async setEventsVenue(eventIds, venueId) {
      // Old behaviour: a response-level error is ignored.
      await client.from('events').update({ venue_id: venueId }).in('id', eventIds)
    },

    async existingEvents(source, externalIds) {
      // Old behaviour: a response-level error reads as "none imported yet".
      const { data } = await client.from('events').select(EXISTING_EVENT_COLUMNS).eq('source', source).in('external_id', externalIds)
      return (data ?? []) as unknown as ExistingEventData[]
    },

    async insertEvent(event) {
      const { error } = await client.from('events').insert(event)
      if (error) throw new Error(error.message)
    },

    async updateEvent(id, patch) {
      const { error } = await client.from('events').update(patch).eq('id', id)
      if (error) throw new Error(error.message)
    },

    async eventsNeedingEnrichment(query) {
      const base = client.from('events').select('id, name, link, source, categories, venue_id, description_es, description_en, facets, enrichment_status, embedding, price, is_free, enrichment_provenance')
      const { data, error } = await enrichmentFilter(base, query).order('starts_at', { ascending: true }).limit(query.limit || 100)
      // Old behaviour: a response-level error reads as an empty batch.
      if (error) console.error('[event-enrichment] Failed to get events needing enrichment:', error)
      return (data || []) as EnrichmentRow[]
    },

    async countEventsNeedingEnrichment(query) {
      const { count, error } = await enrichmentFilter(client.from('events').select('*', { count: 'exact', head: true }), query)
      if (error) console.error('[event-enrichment] Failed to count events needing enrichment:', error)
      return count ?? 0
    },

    async blocklistCandidates() {
      const { data, error } = await client.from('events_with_venues').select('id, name, source, venue_name')
      fail('Failed to fetch events for blocklist cleanup', error)
      return data ?? []
    },

    async deleteEvents(ids) {
      const { error } = await client.from('events').delete().in('id', ids)
      fail('Failed to delete blocklisted events', error)
    },

    async createScrapeRun(run) {
      const { data, error } = await client.from('scrape_runs').insert(run).select().single()
      if (error) throw new Error(`Failed to create scrape run: ${error.message}`)
      return { id: data.id, metadata: data.metadata }
    },

    async failStaleScrapeRuns(cutoff, patch) {
      const { data, error } = await client.from('scrape_runs').update(patch).eq('status', 'running').lt('started_at', cutoff).select('id')
      if (error) throw new Error(`Failed to reconcile stale scrape runs: ${error.message}`)
      return data?.length ?? 0
    },

    async scrapeRunMetadata(id) {
      const { data, error } = await client.from('scrape_runs').select('metadata').eq('id', id).maybeSingle()
      if (error) throw new Error(error.message)
      return data ? data.metadata : undefined
    },

    async updateScrapeRun(id, patch) {
      const { error } = await client.from('scrape_runs').update(patch).eq('id', id)
      if (error) throw new Error(error.message)
    },
  }
}

/** The D1 catalog env: the `DB` binding (d1.server.ts) plus the `VECTORIZE` index the event vectors live in. */
export interface CatalogEnv { DB?: unknown; VECTORIZE?: unknown }

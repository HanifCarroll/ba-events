/**
 * search_events Tool
 *
 * The main event search tool with semantic and filter-based search.
 * Supports natural language queries, time filters, categories, neighborhoods,
 * venues, and price filters. Raw input is canonicalized into a structured
 * intent (must = non-negotiable SQL filters, semanticQuery = retrieval text).
 */

import { z } from 'zod'
import { defineTool } from './types.ts'
import { searchEventsWithFilters, countEventsWithFilters, getFurthestEventDate, hybridEventSearch, getEventsHappeningNow } from '#shared/lib/db/client.server.ts'
import { CATEGORIES } from '#shared/lib/types.ts'
import { getNowInBA, ensureChatEventPayloads, formatEventsToolResult } from './utils.ts'
import {
  canonicalizeSearchIntent,
  applyPreferAvoid,
  type EventSearchMust,
} from './search-intent.ts'
import {
  surpriseRank,
  applyDiversity,
} from './quality-diversity.ts'
import { rerankEvents, type RerankMeta } from '#shared/lib/search/rerank.ts'
import { logger } from '#shared/lib/logger.ts'

// Display vs. candidate limits. The display limit is how many events the user
// asked to see (clamped to 1..5). Candidate limit is how many the retrieval
// layer fetches before ranking/slicing down to what we display. Fetching fifty
// candidates then taking the top-displayLimit by vector order is better than
// asking the RPC for a single row (Phase 1).
export const DISPLAY_LIMIT_DEFAULT = 1
export const DISPLAY_LIMIT_MAX = 5
export const CANDIDATE_LIMIT = 50

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const searchEventsInputSchema = z.object({
  query: z.string().optional().describe(
    `Natural language search query for semantic matching. Use for descriptive/vibe text, and for named days / weekday-only asks ("Saturday", "Monday or Tuesday", "during the week", "on weekdays") which the tool resolves to Buenos Aires date windows. Put other resolvable specifics in their own fields: "free"/"gratis" → isFree, named neighborhoods → neighborhoods, a named venue → venueName, explicit calendar dates → dateFrom/dateTo, exclusions ("except techno") → avoid.`
  ),
  categories: z.array(z.string()).optional().describe(
    `Event categories to filter by. Options: ${CATEGORIES.join(', ')}`
  ),
  neighborhoods: z.array(z.string()).optional().describe(
    'Buenos Aires neighborhoods to filter by (canonical names, or aliases like "Palermo Soho"). Multiple allowed.'
  ),
  venueName: z.string().optional().describe(
    'A named venue / venue alias to search for (e.g. "Niceto"). Resolves to venue ids via venue lookup.'
  ),
  venueIds: z.array(z.string()).optional().describe(
    'Explicit venue database ids to filter by.'
  ),
  dateFrom: z.string().optional().describe(
    'Earliest start date/datetime (ISO) to include events from. Use for explicit calendar dates and ranges the user names.'
  ),
  dateTo: z.string().optional().describe(
    'Latest start date/datetime (ISO) to include events up to. Use for explicit calendar dates and ranges the user names.'
  ),
  isFree: z.boolean().optional().describe('Set to true to only show free events'),
  maxPrice: z.number().optional().describe('Maximum price in ARS'),
  minAge: z.number().optional().describe(
    `The attendee's age (0-99). Filters out events with a higher minimum-age restriction — e.g. set to 18 to exclude events requiring guests over 18. Set this when the user gives an age or asks for events they can attend given their age.`
  ),
  timeFilter: z
    .enum(['now', 'tonight', 'tomorrow', 'weekend', 'week', 'future'])
    .optional()
    .describe(
      'Time period filter. now = started and not yet ended, tonight = today evening, tomorrow = next day, weekend = Saturday/Sunday, week = next 7 days, future = any upcoming event with no upper date limit. Prefer "future" when the user asks about events ahead (e.g. "furthest", "next month", "any time in the future"). Never use "week" for weekday-only asks ("during the week", "on weekdays") — put those in query instead.'
    ),
  avoid: z.array(z.string()).optional().describe(
    `Free-text exclusions — things the user explicitly does NOT want (e.g. ["techno"]). Do not search for excluded genres.`
  ),
  objective: z.enum(['search', 'surprise']).optional().describe(
    `Set to "surprise" for a decisive pick when the user says "surprise me" / "pick for me" — returns one event chosen for quality and near-term timing (not "the soonest"), with no query or hard filters required. Defaults to a derived objective when omitted.`
  ),
  limit: z.number().optional().describe(
    'Maximum number of events to return and display (1-5). Use this to match the user\'s request - e.g., if they ask for "top 3 events", set limit to 3.'
  ),
})

export type SearchEventsInput = z.infer<typeof searchEventsInputSchema>

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const searchEventsTool = defineTool({
  name: 'search_events',

  description: `Search for events in Buenos Aires using semantic search and/or filters.
Use the 'query' parameter for natural language descriptive or vibe text (e.g., "romantic jazz night", "underground techno party", "chill outdoor activities"), plus named days and weekday-only asks ("Saturday", "Monday or Tuesday", "during the week", "on weekdays") which the tool resolves to Buenos Aires date windows.
Put resolvable specifics in dedicated fields instead of query text: free shows in isFree, named neighborhoods in neighborhoods, a named venue in venueName, explicit calendar dates/ranges in dateFrom/dateTo, and exclusions ("except techno") in avoid.
Use other parameters for specific requirements. Combine both for best results.
For "what's on tonight?" asks use timeFilter "tonight"; for "what's happening right now?" use timeFilter "now".
For asks about events further ahead — "furthest", "next month", "anything in the future" — use timeFilter "future" (unbounded). timeFilter "week" means the next 7 days ("this week", "the coming week") — never weekday-only asks ("during the week", "on weekdays").
The result includes coverage metadata: the window you searched, total matches, and the furthest event date on record. Never claim there are no events past the window you actually searched.`,

  inputSchema: searchEventsInputSchema,

  anthropicSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: `Natural language search query for semantic matching. Use for descriptive/vibe text, and for named days / weekday-only asks ("Saturday", "Monday or Tuesday", "during the week", "on weekdays") which the tool resolves to Buenos Aires date windows. Put other resolvable specifics in their own fields: "free"/"gratis" → isFree, named neighborhoods → neighborhoods, a named venue → venueName, explicit calendar dates → dateFrom/dateTo, exclusions ("except techno") → avoid.`,
      },
      categories: {
        type: 'array',
        items: { type: 'string' },
        description: `Event categories to filter by. Options: ${CATEGORIES.join(', ')}`,
      },
      neighborhoods: {
        type: 'array',
        items: { type: 'string' },
        description: 'Buenos Aires neighborhoods to filter by (canonical names, or aliases like "Palermo Soho"). Multiple allowed.',
      },
      venueName: {
        type: 'string',
        description: 'A named venue / venue alias to search for (e.g. "Niceto"). Resolves to venue ids via venue lookup.',
      },
      venueIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Explicit venue database ids to filter by.',
      },
      dateFrom: {
        type: 'string',
        description: 'Earliest start date/datetime (ISO) to include events from. Use for explicit calendar dates and ranges the user names.',
      },
      dateTo: {
        type: 'string',
        description: 'Latest start date/datetime (ISO) to include events up to. Use for explicit calendar dates and ranges the user names.',
      },
      isFree: {
        type: 'boolean',
        description: 'Set to true to only show free events',
      },
      maxPrice: {
        type: 'number',
        description: 'Maximum price in ARS',
      },
      minAge: {
        type: 'number',
        description: "The attendee's age (0-99). Filters out events with a higher minimum-age restriction.",
      },
      timeFilter: {
        type: 'string',
        enum: ['now', 'tonight', 'tomorrow', 'weekend', 'week', 'future'],
        description:
          'Time period filter. now = started and not yet ended, tonight = today evening, tomorrow = next day, weekend = Saturday/Sunday, week = next 7 days, future = any upcoming event with no upper date limit. Prefer "future" when the user asks about events ahead (e.g. "furthest", "next month", "any time in the future"). Never use "week" for weekday-only asks ("during the week", "on weekdays") — put those in query instead.',
      },
      avoid: {
        type: 'array',
        items: { type: 'string' },
        description: `Free-text exclusions — things the user explicitly does NOT want (e.g. ["techno"]).`,
      },
      objective: {
        type: 'string',
        enum: ['search', 'surprise'],
        description: 'Set to "surprise" for a decisive single pick when the user says "surprise me" / "pick for me".',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of events to return and display (1-5). Use this to match the user\'s request - e.g., if they ask for "top 3 events", set limit to 3.',
      },
    },
  },

  requiresAuth: false,

  execute: async (input) => {
    const searchStartedAt = performance.now()
    try {
      // Canonicalize raw input into a structured intent. The must constraints
      // become hard SQL filters; the leftover semanticQuery drives retrieval.
      // Venue resolution is async (DB lookup).
      const intent = await canonicalizeSearchIntent(input, getNowInBA())
      // must -> hard filters, plus avoid genres as hard facet excludes.
      const filters = applyPreferAvoid(intent)
      const displayLimit = intent.displayLimit
      const query = intent.semanticQuery
      const objective = intent.objective

      // Avoid terms for the hosted reranker are soft context only. Genres
      // already hard-excluded upstream (intent.avoid.genres) are gone from the
      // candidate set, so pass the raw input.avoid strings only when no genre
      // was hard-excluded.
      const rerankAvoid = intent.avoid.genres?.length ? [] : (input.avoid ?? [])

      logger.debug('[search_events] Search parameters', {
        input,
        intent,
        filters,
        displayLimit,
        currentTime: new Date().toISOString(),
        baTime: getNowInBA().toISOString(),
      })

      // Unknown venue: user named a venue that resolved to zero venues. Do not
      // silently drop the constraint — report success with zero events and a
      // note so the model can correct the name.
      if (input.venueName && (!intent.must.venueIds || intent.must.venueIds.length === 0)) {
        const maxEventDate = await getFurthestEventDate()
        const formatted = JSON.stringify({
          count: 0,
          events: [],
          note: `unknown venue: ${input.venueName}`,
        })
        return {
          success: true,
          events: [],
          formatted,
          metadata: {
            resultCount: 0,
            hasQuery: !!query,
            hasFilters: true,
            searchMode: 'filter_only',
            coverage: {
              searchedFrom: filters.startsAfter ?? null,
              searchedTo: filters.startsBefore ?? null,
              totalMatches: 0,
              returned: 0,
              maxEventDate,
            },
            toolInput: input,
          },
        }
      }

      let results
      // The retrieval mode, reported in metadata/telemetry.
      let searchMode: 'semantic' | 'filter_only' | 'now' | 'surprise' = 'filter_only'
      // Hosted rerank diagnostics, reported in metadata/telemetry.
      let rerankMeta: RerankMeta | null = null

      // Coverage bookkeeping: how many events actually match the window (vs.
      // how many were returned), and how far the calendar truly reaches.
      let totalMatches: number

      if (input.timeFilter === 'now') {
        // "Now" can't be expressed as a starts_at range - it means events that
        // already started and haven't ended. Fetch those, then apply the
        // remaining `must` filters in memory.
        searchMode = 'now'
        let nowEvents = await getEventsHappeningNow()
        // A dateFrom/dateTo window on the now-path applies as hard bounds on
        // starts_at (canonicalize set them even though 'now' alone sets no
        // range). An empty intersection → zero events, and we must not widen.
        if (filters.startsAfter || filters.startsBefore) {
          // Parse with Date so ISO format variants still compare correctly
          // (raw string comparison would break on offset/fractional variants).
          const after = filters.startsAfter ? new Date(filters.startsAfter).getTime() : null
          const before = filters.startsBefore ? new Date(filters.startsBefore).getTime() : null
          nowEvents = nowEvents.filter((e) => {
            const start = new Date(e.starts_at).getTime()
            if (after !== null && start < after) return false
            if (before !== null && start > before) return false
            return true
          })
        }
        if (filters.categories?.length) {
          nowEvents = nowEvents.filter((e) =>
            filters.categories!.some((c) => e.categories.includes(c))
          )
        }
        if (filters.neighborhoods?.length) {
          nowEvents = nowEvents.filter(
            (e) => !!e.venue_neighborhood && filters.neighborhoods!.includes(e.venue_neighborhood)
          )
        }
        if (filters.venueIds?.length) {
          nowEvents = nowEvents.filter(
            (e) => !!e.venue_id && filters.venueIds!.includes(e.venue_id)
          )
        }
        if (filters.isFree) {
          nowEvents = nowEvents.filter((e) => e.is_free)
        }
        if (filters.maxPrice !== undefined) {
          nowEvents = nowEvents.filter((e) => (e.price ?? 0) <= filters.maxPrice!)
        }
        if (filters.minAge !== undefined) {
          nowEvents = nowEvents.filter((e) => e.min_age == null || e.min_age <= filters.minAge!)
        }
        if (filters.avoidGenres?.length) {
          nowEvents = nowEvents.filter((e) => {
            if (!e.facets?.genres?.length) return true
            return !e.facets.genres.some((g) => filters.avoidGenres!.includes(g))
          })
        }
        totalMatches = nowEvents.length
        if (objective === 'surprise') {
          searchMode = 'surprise'
          // Surprise is always exactly one pick, ignoring displayLimit.
          results = surpriseRank(nowEvents, getNowInBA().getTime()).slice(0, 1)
        } else {
          // The happening-now list is reranked by the hosted reranker (input
          // order = chronological RPC order = baseRank), then gets the same
          // diversity pass as other lists before slicing to the display limit.
          // A pure "what's happening now" with no query/prefer/avoid no-ops.
          const { ordered: reranked, meta } = await rerankEvents(nowEvents, {
            semanticQuery: query,
            prefer: intent.prefer,
            avoid: rerankAvoid,
          })
          rerankMeta = meta
          results =
            displayLimit > 1
              ? applyDiversity(reranked, displayLimit)
              : reranked.slice(0, displayLimit)
        }
      } else {
        // Coverage count reflects the full window (ignores semantic ranking and
        // limit) so the model can see how much exists vs. how much it got back.
        totalMatches = await countEventsWithFilters(filters)
        if (objective === 'surprise') {
          // Surprise: no query, no hard must. Rank the filtered upcoming set by
          // quality + near-term decay (NOT chronological "soonest"), return one.
          searchMode = 'surprise'
          const rankStartedAt = performance.now()
          const candidates = await searchEventsWithFilters(filters, CANDIDATE_LIMIT)
          const ranked = surpriseRank(candidates, getNowInBA().getTime())
          // Surprise always returns exactly 1, ignoring displayLimit.
          results = ranked.slice(0, 1)
          logger.debug('[search_events] Using surprise ranking', {
            candidates: candidates.length,
            topId: ranked[0]?.id,
            rankMs: Math.round(performance.now() - rankStartedAt),
          })
        } else if (query) {
          searchMode = 'semantic'
          logger.debug('[search_events] Using hybrid search', { query })
          // Retrieve CANDIDATE_LIMIT nearest vector neighbors, then rerank
          // them with the hosted reranker (input order = fused retrieval order
          // = baseRank) before the diversity pass. Ranking only — never drops
          // events, and never applies to the surprise path.
          const candidates = await hybridEventSearch(query, filters, CANDIDATE_LIMIT)
          const { ordered: reranked, meta } = await rerankEvents(candidates, {
            semanticQuery: query,
            prefer: intent.prefer,
            avoid: rerankAvoid,
          })
          rerankMeta = meta
          results =
            displayLimit > 1
              ? applyDiversity(reranked, displayLimit)
              : reranked.slice(0, displayLimit)
        } else {
          // No semantic text left after canonicalize — filter-only search
          // (chronological), reranked by the hosted reranker when a non-empty
          // prefer gives it signal (e.g. "jazz tonight"), then list diversity
          // applied when displaying >1. Nothing subjective → no-op, stays
          // chronological.
          logger.debug('[search_events] Using filter-only search')
          const candidates = await searchEventsWithFilters(filters, CANDIDATE_LIMIT)
          const { ordered: reranked, meta } = await rerankEvents(candidates, {
            semanticQuery: query,
            prefer: intent.prefer,
            avoid: rerankAvoid,
          })
          rerankMeta = meta
          results =
            displayLimit > 1 ? applyDiversity(reranked, displayLimit) : reranked.slice(0, displayLimit)
        }
      }

      // Furthest future event on record — the true coverage horizon the model
      // must answer "furthest into the future" from.
      const maxEventDate = await getFurthestEventDate()

      const durationMs = Math.round(performance.now() - searchStartedAt)

      logger.info('[search_events] Search completed', {
        resultCount: results.length,
        totalMatches,
        hasQuery: !!query,
        searchMode,
        durationMs,
        maxEventDate,
      })

      if (rerankMeta) {
        logger.info('[search_events] Rerank', {
          status: rerankMeta.status,
          model: rerankMeta.model,
          latencyMs: rerankMeta.latencyMs,
          totalTokens: rerankMeta.totalTokens,
          displayed:
            rerankMeta.status === 'applied'
              ? results.map((e) => {
                  const r = rerankMeta.ranks?.get(e.id)
                  return r
                    ? {
                        id: e.id,
                        baseRank: r.baseRank,
                        rerankerRank: r.rerankerRank,
                        finalRank: r.finalRank,
                      }
                    : { id: e.id }
                })
              : undefined,
        })
      }

      const formatted = formatEventsToolResult(results)

      return {
        success: true,
        events: ensureChatEventPayloads(results),
        formatted,
        metadata: {
          resultCount: results.length,
          hasQuery: !!query,
          hasFilters: hasMustConstraints(intent.must),
          searchMode,
          ...(rerankMeta ? { rerank: rerankMeta.status } : {}),
          durationMs,
          // Coverage metadata: what window was searched, how many matched, and
          // the true furthest event date. The model must never claim a ceiling
          // beyond this — if it only searched a narrow window, coverage makes
          // that explicit so it says "I only searched up to X" instead of
          // "there are no events past X".
          coverage: {
            searchedFrom: filters.startsAfter ?? null,
            searchedTo: filters.startsBefore ?? null,
            totalMatches,
            returned: results.length,
            maxEventDate,
          },
          // Include input for refinement suggestion generation
          toolInput: input,
        },
      }
    } catch (error) {
      logger.error('[search_events] Search failed', { error: String(error) })
      return {
        success: false,
        formatted: JSON.stringify({ error: 'Failed to search for events' }),
        error: 'execution_error',
      }
    }
  },
})

// Whether the canonicalized intent carries any non-time must constraint
// (used for the telemetry `hasFilters` flag).
function hasMustConstraints(must: EventSearchMust): boolean {
  return !!(
    must &&
    ((must.neighborhoodIds && must.neighborhoodIds.length > 0) ||
      (must.venueIds && must.venueIds.length > 0) ||
      (must.categories && must.categories.length > 0) ||
      !!must.startsAfter ||
      !!must.startsBefore ||
      must.isFree !== undefined ||
      must.maxPrice !== undefined ||
      must.attendeeAge !== undefined)
  )
}

import { createServerFn } from '@tanstack/react-start'
import { requireAdminAccess } from '@/shared/lib/admin-utils'
import type {
  DateRange,
  ActiveUsersData,
  PageviewDataPoint,
  TopEvent,
  SearchTerm,
  EventEngagement,
} from '../types'

// PostHog API configuration
const POSTHOG_HOST = process.env.VITE_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'
const POSTHOG_API_KEY = process.env.POSTHOG_PERSONAL_API_KEY
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID

// Simple in-memory cache with 5-minute TTL
const cache = new Map<string, { data: unknown; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key)
    return null
  }
  return entry.data as T
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() })
}

// Convert date range to interval string
function rangeToInterval(range: DateRange): string {
  switch (range) {
    case '7d':
      return '7 DAY'
    case '30d':
      return '30 DAY'
    case '90d':
      return '90 DAY'
  }
}

// Convert date range to days number
function rangeToDays(range: DateRange): number {
  switch (range) {
    case '7d':
      return 7
    case '30d':
      return 30
    case '90d':
      return 90
  }
}

// Execute HogQL query against PostHog
async function executeHogQL<T>(query: string): Promise<T> {
  if (!POSTHOG_API_KEY || !POSTHOG_PROJECT_ID) {
    throw new Error('PostHog API key or project ID not configured')
  }

  const response = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${POSTHOG_API_KEY}`,
    },
    body: JSON.stringify({
      query: {
        kind: 'HogQLQuery',
        query,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('PostHog API error:', errorText)
    throw new Error(`PostHog API error: ${response.status}`)
  }

  const result = await response.json()
  return result.results as T
}

/**
 * Get active users (DAU/WAU/MAU) with trend percentages
 * Uses $pageview events as the standard metric for user activity
 */
export const getActiveUsers = createServerFn({ method: 'GET' })
  .inputValidator((range: DateRange) => range)
  .handler(async ({ data: range }): Promise<ActiveUsersData> => {
    await requireAdminAccess()

    const cacheKey = `active-users-${range}`
    const cached = getCached<ActiveUsersData>(cacheKey)
    if (cached) return cached

    // Simple queries for each metric - using $pageview as the standard for active users
    const dauQuery = `
      SELECT uniqExact(distinct_id) as count
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - INTERVAL 1 DAY
    `

    const wauQuery = `
      SELECT uniqExact(distinct_id) as count
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - INTERVAL 7 DAY
    `

    const mauQuery = `
      SELECT uniqExact(distinct_id) as count
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - INTERVAL 30 DAY
    `

    // Previous period queries for trends
    const prevDauQuery = `
      SELECT uniqExact(distinct_id) as count
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - INTERVAL 2 DAY
        AND timestamp < now() - INTERVAL 1 DAY
    `

    const prevWauQuery = `
      SELECT uniqExact(distinct_id) as count
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - INTERVAL 14 DAY
        AND timestamp < now() - INTERVAL 7 DAY
    `

    const prevMauQuery = `
      SELECT uniqExact(distinct_id) as count
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - INTERVAL 60 DAY
        AND timestamp < now() - INTERVAL 30 DAY
    `

    // Run all queries in parallel
    const [dauRes, wauRes, mauRes, prevDauRes, prevWauRes, prevMauRes] = await Promise.all([
      executeHogQL<number[][]>(dauQuery),
      executeHogQL<number[][]>(wauQuery),
      executeHogQL<number[][]>(mauQuery),
      executeHogQL<number[][]>(prevDauQuery),
      executeHogQL<number[][]>(prevWauQuery),
      executeHogQL<number[][]>(prevMauQuery),
    ])

    const dau = dauRes[0]?.[0] ?? 0
    const wau = wauRes[0]?.[0] ?? 0
    const mau = mauRes[0]?.[0] ?? 0
    const prevDau = prevDauRes[0]?.[0] ?? 0
    const prevWau = prevWauRes[0]?.[0] ?? 0
    const prevMau = prevMauRes[0]?.[0] ?? 0

    // Calculate percentage trends
    const calcTrend = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0
      return Math.round(((current - previous) / previous) * 100)
    }

    const data: ActiveUsersData = {
      dau,
      wau,
      mau,
      dauTrend: calcTrend(dau, prevDau),
      wauTrend: calcTrend(wau, prevWau),
      mauTrend: calcTrend(mau, prevMau),
    }

    setCache(cacheKey, data)
    return data
  })

/**
 * Get pageviews time series data
 */
export const getPageviews = createServerFn({ method: 'GET' })
  .inputValidator((range: DateRange) => range)
  .handler(async ({ data: range }): Promise<PageviewDataPoint[]> => {
    await requireAdminAccess()

    const cacheKey = `pageviews-${range}`
    const cached = getCached<PageviewDataPoint[]>(cacheKey)
    if (cached) return cached

    const query = `
      SELECT
        toDate(timestamp) as date,
        count() as pageviews,
        uniqExact(distinct_id) as unique_users
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - INTERVAL ${rangeToInterval(range)}
      GROUP BY date
      ORDER BY date ASC
    `

    const results = await executeHogQL<(string | number)[][]>(query)

    const data: PageviewDataPoint[] = results.map((row) => ({
      date: String(row[0]),
      pageviews: Number(row[1]),
      uniqueUsers: Number(row[2]),
    }))

    setCache(cacheKey, data)
    return data
  })

/**
 * Get top events by views
 */
export const getTopEvents = createServerFn({ method: 'GET' })
  .inputValidator((range: DateRange) => range)
  .handler(async ({ data: range }): Promise<TopEvent[]> => {
    await requireAdminAccess()

    const cacheKey = `top-events-${range}`
    const cached = getCached<TopEvent[]>(cacheKey)
    if (cached) return cached

    const query = `
      SELECT
        properties.event_id as event_id,
        any(properties.event_name) as event_name,
        countIf(event = 'event:viewed') as views,
        countIf(event = 'event:saved') as saves,
        countIf(event = 'event:link_clicked') as clicks
      FROM events
      WHERE event IN ('event:viewed', 'event:saved', 'event:link_clicked')
        AND timestamp >= now() - INTERVAL ${rangeToInterval(range)}
        AND properties.event_id IS NOT NULL
      GROUP BY properties.event_id
      ORDER BY views DESC
      LIMIT 10
    `

    const results = await executeHogQL<(string | number)[][]>(query)

    const data: TopEvent[] = results.map((row) => ({
      eventId: String(row[0]),
      eventName: String(row[1]) || 'Unknown Event',
      views: Number(row[2]),
      saves: Number(row[3]),
      clicks: Number(row[4]),
    }))

    setCache(cacheKey, data)
    return data
  })

/**
 * Get top search terms
 */
export const getSearchTerms = createServerFn({ method: 'GET' })
  .inputValidator((range: DateRange) => range)
  .handler(async ({ data: range }): Promise<SearchTerm[]> => {
    await requireAdminAccess()

    const cacheKey = `search-terms-${range}`
    const cached = getCached<SearchTerm[]>(cacheKey)
    if (cached) return cached

    const query = `
      SELECT
        trim(lower(properties.query)) as query,
        count() as search_count,
        avg(properties.events_returned) as avg_results
      FROM events
      WHERE event = 'chat:message_sent'
        AND timestamp >= now() - INTERVAL ${rangeToInterval(range)}
        AND properties.query IS NOT NULL
        AND properties.query != ''
      GROUP BY trim(lower(properties.query))
      ORDER BY search_count DESC
      LIMIT 20
    `

    const results = await executeHogQL<(string | number)[][]>(query)

    const data: SearchTerm[] = results.map((row) => ({
      query: String(row[0]),
      count: Number(row[1]),
      avgResultsReturned: Math.round(Number(row[2]) || 0),
    }))

    setCache(cacheKey, data)
    return data
  })

/**
 * Get event engagement totals (saves, clicks) with trends
 */
export const getEventEngagement = createServerFn({ method: 'GET' })
  .inputValidator((range: DateRange) => range)
  .handler(async ({ data: range }): Promise<EventEngagement> => {
    await requireAdminAccess()

    const cacheKey = `engagement-${range}`
    const cached = getCached<EventEngagement>(cacheKey)
    if (cached) return cached

    const days = rangeToDays(range)
    const interval = rangeToInterval(range)

    // Current period
    const currentQuery = `
      SELECT
        countIf(event = 'event:saved') as saves,
        countIf(event = 'event:link_clicked') as clicks
      FROM events
      WHERE event IN ('event:saved', 'event:link_clicked')
        AND timestamp >= now() - INTERVAL ${interval}
    `

    // Previous period
    const previousQuery = `
      SELECT
        countIf(event = 'event:saved') as saves,
        countIf(event = 'event:link_clicked') as clicks
      FROM events
      WHERE event IN ('event:saved', 'event:link_clicked')
        AND timestamp >= now() - INTERVAL ${days * 2} DAY
        AND timestamp < now() - INTERVAL ${interval}
    `

    const [currentResults, previousResults] = await Promise.all([
      executeHogQL<number[][]>(currentQuery),
      executeHogQL<number[][]>(previousQuery),
    ])

    const [saves, clicks] = currentResults[0] || [0, 0]
    const [prevSaves, prevClicks] = previousResults[0] || [0, 0]

    const calcTrend = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0
      return Math.round(((current - previous) / previous) * 100)
    }

    const data: EventEngagement = {
      totalSaves: saves,
      totalClicks: clicks,
      savesTrend: calcTrend(saves, prevSaves),
      clicksTrend: calcTrend(clicks, prevClicks),
    }

    setCache(cacheKey, data)
    return data
  })

/**
 * Analytics types for PostHog dashboard
 */

export type DateRange = '7d' | '30d' | '90d'

export interface ActiveUsersData {
  dau: number
  wau: number
  mau: number
  dauTrend: number // percentage change from previous period
  wauTrend: number
  mauTrend: number
}

export interface PageviewDataPoint {
  date: string // ISO date string YYYY-MM-DD
  pageviews: number
  uniqueUsers: number
}

export interface TopEvent {
  eventId: string
  eventName: string
  views: number
  saves: number
  clicks: number
}

export interface SearchTerm {
  query: string
  count: number
  avgResultsReturned: number
}

export interface EventEngagement {
  totalSaves: number
  totalClicks: number
  savesTrend: number // percentage change from previous period
  clicksTrend: number
}

// API response wrapper
export interface AnalyticsResponse<T> {
  data: T
  fetchedAt: string // ISO timestamp for cache validation
}

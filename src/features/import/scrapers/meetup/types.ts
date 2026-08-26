import type { EventStatus } from '#shared/lib/types.ts'

/**
 * Types for Meetup Scraper
 *
 * Represents data scraped from meetup.com Buenos Aires events
 */

/**
 * Meetup group (organizer) information
 */
export interface MeetupGroup {
  /** Group name (e.g., "Buenos Aires Salon Society") */
  name: string
  /** URL-friendly name used in Meetup URLs */
  urlname: string
  /** Group rating (e.g., 4.7) */
  rating: number | null
}

/**
 * Meetup venue information
 */
export interface MeetupVenue {
  /** Venue name */
  name: string
  /** Street address */
  address: string | null
  /** City (usually "Buenos Aires") */
  city: string | null
  /** Latitude coordinate */
  lat: number | null
  /** Longitude coordinate */
  lng: number | null
}

/**
 * Raw event data scraped from Meetup
 */
export interface MeetupEvent {
  /** Meetup event ID (from URL or GraphQL data) */
  id: string

  /** Event title */
  name: string

  /** Event description (may be null if not available from list page) */
  description: string | null

  /** Start datetime (ISO 8601 format) */
  dateTime: string

  /** End datetime if available (ISO 8601 format) */
  endTime: string | null

  /** Timezone (e.g., "America/Argentina/Buenos_Aires") */
  timezone: string

  /** Event URL on Meetup */
  eventUrl: string

  /** Cover image URL */
  imageUrl: string | null

  /** Venue information (null for online-only events) */
  venue: MeetupVenue | null

  /** Is this an online-only event? */
  isOnline: boolean

  /** Normalized status from Meetup detail data */
  status: EventStatus

  /** Organizer group */
  group: MeetupGroup

  /** Number of attendees */
  attendeeCount: number

  /** Meetup category (e.g., "Technology", "Social Activities") */
  category: string | null

  /** Is this a recurring event? */
  isRecurring: boolean

  /** Recurrence pattern text (e.g., "Every Wed", "Every Sat") */
  recurrencePattern: string | null

  /** Price in ARS (null = free) */
  price: number | null

  /** Currency for paid events (e.g., "ARS", "USD") */
  currency: string | null
}

/**
 * Meetup categories observed on the platform
 */
export const MEETUP_CATEGORIES = [
  'Social Activities',
  'Hobbies & Passions',
  'Sports & Fitness',
  'Travel & Outdoor',
  'Career & Business',
  'Technology',
  'Community & Environment',
  'Identity & Language',
  'Games',
  'Health & Wellbeing',
  'Arts & Culture',
  'Language & Culture',
] as const

export type MeetupCategory = (typeof MEETUP_CATEGORIES)[number]

/**
 * Parsed date/time from Meetup format
 */
export interface ParsedMeetupDateTime {
  /** Parsed date */
  date: Date
  /** Start time in HH:mm format */
  startTime: string | null
  /** End time in HH:mm format (if available) */
  endTime: string | null
}

/**
 * GraphQL response structure (discovered via network inspection)
 * This represents the shape we expect from intercepted GraphQL responses
 */
export interface MeetupGraphQLEvent {
  id: string
  title: string
  description?: string
  dateTime: string
  endTime?: string
  timezone: string
  eventUrl: string
  imageUrl?: string
  isOnline: boolean
  going: number
  venue?: {
    name: string
    address?: string
    city?: string
    lat?: number
    lng?: number
  }
  group: {
    name: string
    urlname: string
    rating?: number
  }
  eventType?: string
  feeSettings?: {
    amount?: number
    currency?: string
  }
}

/**
 * Types for BA Tourism Scraper
 *
 * Represents data scraped from turismo.buenosaires.gob.ar
 */

/**
 * Coordinates extracted from Google Maps links
 */
export interface Coordinates {
  lat: number
  lng: number
}

/**
 * Parsed date/time from Spanish text
 */
export interface ParsedDateTime {
  date: Date
  startTime: string | null // "HH:mm" format
  endTime: string | null // "HH:mm" format
}

/**
 * Raw event data scraped from BA Tourism website
 */
export interface BATourismEvent {
  /** Event title */
  name: string

  /** Category from the website (Danza, Música, Teatro, etc.) */
  category: string

  /** Whether the event is free (from "Gratis" indicator) */
  isFree: boolean

  /** Raw Spanish date/time text (e.g., "Martes 23, 20 h.") */
  whenText: string

  /** Venue name */
  venueName: string

  /** Neighborhood (e.g., "San Nicolás", "Palermo") */
  neighborhood: string

  /** Street address if available */
  address: string | null

  /** GPS coordinates from Google Maps link */
  coordinates: Coordinates | null

  /** Event description */
  description: string

  /** URL to more information / detail page */
  moreInfoUrl: string
}

/**
 * Week context parsed from page header
 * (e.g., "Desde el lunes 29 al domingo 4 de enero")
 */
export interface WeekContext {
  startDate: Date
  endDate: Date
}

/**
 * Categories available on BA Tourism website
 */
export const BA_TOURISM_CATEGORIES = [
  'Danza',
  'Música',
  'Teatro',
  'Evento',
  'Visita guiada',
  'Artes visuales',
  'Infantil',
  'Deporte',
  'Exposición',
  'Feria',
  'Gastronomía',
  'Aire libre',
] as const

export type BATourismCategory = (typeof BA_TOURISM_CATEGORIES)[number]

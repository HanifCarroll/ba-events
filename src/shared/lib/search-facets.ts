/**
 * Closed vocabularies + Zod schema for structured search facets (Phase 5).
 *
 * Facets live on `events.facets` (jsonb). Values are stored as canonical
 * ENGLISH keys, but extraction accepts Spanish synonyms and stores the English
 * canonical form. Only a key present in these closed lists may be stored — the
 * Zod schema rejects anything else (including an unknown genre).
 *
 * Do NOT grow `CATEGORIES` here; facets are a separate axis from the six
 * event categories. Extend these lists only from eval failures, never
 * ad hoc per event.
 */
import { z } from 'zod'

export const EVENT_TYPE_VALUES = [
  'concert',
  'party',
  'class',
  'festival',
  'exhibition',
  'food',
  'sports',
  'meetup',
] as const
export type EventFacetType = (typeof EVENT_TYPE_VALUES)[number]

export const GENRE_VALUES = [
  'techno',
  'house',
  'jazz',
  'tango',
  'rock',
  'folk',
  'classical',
  'reggaeton',
  'hip-hop',
  'indie',
  'electronic',
] as const
export type EventFacetGenre = (typeof GENRE_VALUES)[number]

export const VIBE_VALUES = [
  'intimate',
  'romantic',
  'relaxed',
  'energetic',
  'underground',
  'family',
  'touristy',
] as const
export type EventFacetVibe = (typeof VIBE_VALUES)[number]

export const ACTIVITY_VALUES = [
  'live-music',
  'dancing',
  'dinner',
  'drinks',
  'workshop',
  'talk',
  'outdoor',
  'screening',
] as const
export type EventFacetActivity = (typeof ACTIVITY_VALUES)[number]

export const AUDIENCE_VALUES = [
  'couples',
  'friends',
  'families',
  'solo',
  'networking',
] as const
export type EventFacetAudience = (typeof AUDIENCE_VALUES)[number]

export const SETTING_VALUES = [
  'indoor',
  'outdoor',
  'seated',
  'standing',
] as const
export type EventFacetSetting = (typeof SETTING_VALUES)[number]

const ENERGY_VALUES = ['low', 'medium', 'high'] as const
const SOCIAL_INTERACTION_VALUES = ['low', 'medium', 'high'] as const

/**
 * Zod schema for `events.facets`. All array fields default to `[]` so that
 * parsing a non-empty object is always safe (empty arrays are correct —
 * the extractor only assigns keys the source text supports). `energy` and
 * `socialInteraction` are optional single enum values.
 */
export const eventFacetsSchema = z.object({
  eventType: z.array(z.enum(EVENT_TYPE_VALUES)).default([]),
  genres: z.array(z.enum(GENRE_VALUES)).default([]),
  activities: z.array(z.enum(ACTIVITY_VALUES)).default([]),
  vibes: z.array(z.enum(VIBE_VALUES)).default([]),
  audience: z.array(z.enum(AUDIENCE_VALUES)).default([]),
  setting: z.array(z.enum(SETTING_VALUES)).default([]),
  energy: z.enum(ENERGY_VALUES).optional(),
  socialInteraction: z.enum(SOCIAL_INTERACTION_VALUES).optional(),
})

export type EventFacets = z.infer<typeof eventFacetsSchema>

/** The empty facets object used as the DB default / safe fallback. */
export const EMPTY_FACETS: EventFacets = eventFacetsSchema.parse({})

/**
 * Parse a raw object into a valid `EventFacets`, dropping unknown keys and
 * rejecting unknown enum values. Unknown genre → throws (schema reject).
 */
export function parseEventFacets(value: unknown): EventFacets {
  return eventFacetsSchema.parse(value)
}

/**
 * True when a facets value is semantically empty, so we don't re-extract.
 *
 * Two shapes count as empty:
 *   - the literal empty object `{}` (the jsonb column default / our failure
 *     fallback), and
 *   - an object whose arrays are all empty and that has no `energy` /
 *     `socialInteraction` keys (the result of parsing `{}` through
 *     `eventFacetsSchema`, which expands to six empty arrays).
 */
export function isEmptyFacets(facets: unknown): boolean {
  if (!facets || typeof facets !== 'object') return true
  const rec = facets as Record<string, unknown>
  const keys = Object.keys(rec)
  if (keys.length === 0) return true
  // If only array keys are present and every array is empty, and there are no
  // energy/socialInteraction keys, the object is semantically empty.
  const arrayKeys = new Set([
    'eventType',
    'genres',
    'activities',
    'vibes',
    'audience',
    'setting',
  ])
  return (
    !('energy' in rec) &&
    !('socialInteraction' in rec) &&
    keys.every((key) => arrayKeys.has(key) && Array.isArray(rec[key]) && rec[key].length === 0)
  )
}

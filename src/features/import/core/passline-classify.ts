/**
 * Passline Event Classification
 *
 * Pure, dependency-light classification of an incoming Passline event against
 * its existing row. Extracted from the core import so the decision logic is
 * unit-testable without pulling in AI, embedding, or Supabase modules.
 */
import type { EventInsert, Category } from '#shared/lib/types.ts'
import type { EventFacets } from '#shared/lib/search-facets.ts'

/** Existing Passline event row, with the fields needed to classify and re-embed. */
export interface ExistingPasslineEvent {
  id: string
  external_id: string
  name: string
  starts_at: string
  ends_at: string | null
  is_all_day: boolean
  venue_id: string | null
  price: number | null
  is_free: boolean
  time_tba: boolean
  ticket_url: string | null
  location_tba: boolean
  image_url: string | null
  link: string | null
  description_es: string | null
  description_en: string | null
  categories: Category[]
  facets: EventFacets
}

/**
 * Classification of an incoming Passline event against its existing row.
 *
 * Priority (matches the reviewed plan):
 * - `name-changed` — recategorize + re-embed using stored descriptions
 * - `search-input-changed` — price/venue/is_free changed, re-embed only
 * - `mutable-only` — non-search fields changed, direct update (no AI/embed)
 * - `unchanged` — no write, no AI, no embed
 */
export type PasslineClassification =
  | { kind: 'new' }
  | { kind: 'unchanged' }
  | { kind: 'mutable-only' }
  | { kind: 'name-changed' }
  | { kind: 'search-input-changed' }

/**
 * How venue settlement resolved for an event.
 * - `resolved` — settlement produced a venue id (matched / auto-created / queued-review).
 * - `placeholder` — explicit TBA / "register to see address": clear any existing venue.
 * - `unresolved` — settlement produced no venue id for another reason (skipped / empty): preserve existing venue.
 */
export type VenueSettlement =
  | { kind: 'resolved'; venueId: string }
  | { kind: 'placeholder' }
  | { kind: 'unresolved' }

function changedDate(a: string | null, b: string | null): boolean {
  if (a === b) return false
  if (!a || !b) return a !== b
  return new Date(a).getTime() !== new Date(b).getTime()
}

export function classifyPasslineEvent(
  incoming: EventInsert,
  existing: ExistingPasslineEvent,
  settlement: VenueSettlement
): PasslineClassification {
  const nameChanged = incoming.name !== existing.name

  let venueChanged = false
  if (settlement.kind === 'resolved') {
    venueChanged = settlement.venueId !== existing.venue_id
  } else if (settlement.kind === 'placeholder') {
    // Explicit placeholder/TBA clears any previously-settled venue.
    venueChanged = existing.venue_id !== null
  }
  // `unresolved` preserves the existing venue, so it never counts as a change.

  const priceChanged = (incoming.price ?? null) !== (existing.price ?? null)
  const isFreeChanged = (incoming.is_free ?? false) !== existing.is_free
  const searchInputChanged = venueChanged || priceChanged || isFreeChanged

  const mutableChanged =
    changedDate(incoming.starts_at, existing.starts_at) ||
    changedDate(incoming.ends_at ?? null, existing.ends_at) ||
    (incoming.is_all_day ?? false) !== existing.is_all_day ||
    (incoming.time_tba ?? false) !== existing.time_tba ||
    (incoming.ticket_url ?? null) !== (existing.ticket_url ?? null) ||
    (incoming.location_tba ?? false) !== existing.location_tba ||
    (incoming.image_url ?? null) !== (existing.image_url ?? null) ||
    (incoming.link ?? null) !== (existing.link ?? null)

  if (nameChanged) return { kind: 'name-changed' }
  if (searchInputChanged) return { kind: 'search-input-changed' }
  if (mutableChanged) return { kind: 'mutable-only' }
  return { kind: 'unchanged' }
}

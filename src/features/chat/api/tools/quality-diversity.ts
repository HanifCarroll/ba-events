/**
 * Phase 9 — Surprise-me ranking, quality, and list diversity for search_events.
 *
 * These are deterministic *final* rules applied AFTER the retrieval layer. They
 * must NEVER change the semantic path's relevance order (vector/RRF fusion) —
 * diversity only drops near-duplicates / over-capped events on lists, keeping
 * the relative order of the survivors. Quality is a ranking signal ONLY for the
 * surprise ("pick one for me") objective, where there is no query to be
 * relevant to.
 */

import { normalizeText } from '@/shared/lib/utils/normalize-text'

/** Fields the surprise scorer / diversity pass read off an event. */
export interface SearchScoreable {
  id: string
  name: string
  starts_at: string
  image_url: string | null
  venue_id: string | null
  venue_name: string | null
  location_tba: boolean
  description_unavailable: boolean
  categories: string[]
}

export const QUALITY_WEIGHT = 2
export const SOON_WEIGHT = 1
// Soonness decays over ~2 days ("next few days"), not a hard "soonest". Keep
// it modest relative to quality so a complete but slightly later event beats an
// incomplete one that happens to be first.
export const SOON_DECAY_HOURS = 48
// Diversity caps per list result.
export const MAX_PER_VENUE = 2
export const MAX_PER_CATEGORY = 3

// ============================================================================
// QUALITY
// ============================================================================

/** Has a real, non-empty venue reference (id or a venue name). */
function hasVenue(ev: SearchScoreable): boolean {
  return !!ev.venue_id || !!ev.venue_name
}

/** Quality of an event card: complete, distinct info a pick can stand on. 0..4. */
export function qualityScore(ev: SearchScoreable): number {
  let s = 0
  if (!!ev.image_url) s += 1
  if (!ev.location_tba) s += 1
  if (!ev.description_unavailable) s += 1
  if (hasVenue(ev)) s += 1
  return s
}

// ============================================================================
// SOONNESS (decay over the next few days, not "the soonest")
// ============================================================================

/**
 * 0..1 where events starting within SOON_DECAY_HOURS score highest and fade
 * smoothly beyond. We want a *near future* pick — a strong pull to the next
 * couple of days — without locking onto the literal earliest start.
 */
export function soonnessScore(startsAt: string, nowMs: number): number {
  const start = new Date(startsAt).getTime()
  if (Number.isNaN(start)) return 0
  const hours = Math.max(0, (start - nowMs) / 3_600_000)
  return Math.exp(-hours / SOON_DECAY_HOURS)
}

// ============================================================================
// NEAR-DUPLICATE PENALTY
// ============================================================================

/** Canonical token set used to compare names irrespective of filler/order. */
function nameTokens(name: string): string[] {
  return normalizeText(name).split(' ').filter(Boolean)
}

/**
 * Is `a` a near-duplicate of `b`? Same venue and effectively the same title —
 * the shorter token list is mostly contained in the longer (series variants
 * like "X — Day 1" / "X — Day 2" share the core name).
 */
export function isNearDuplicate(a: SearchScoreable, b: SearchScoreable): boolean {
  if (!hasVenue(a) || !hasVenue(b)) return false
  if (a.venue_id && b.venue_id && a.venue_id !== b.venue_id) return false
  if (!!a.venue_id !== !!b.venue_id) return false
  if (!a.venue_id && !b.venue_id && a.venue_name !== b.venue_name) return false

  const ta = nameTokens(a.name)
  const tb = nameTokens(b.name)
  if (ta.length === 0 || tb.length === 0) return false
  const shorter = ta.length <= tb.length ? ta : tb
  const longer = ta.length <= tb.length ? tb : ta
  // >= 2/3 of the shorter name's meaningful tokens appear in the longer.
  let contained = 0
  for (const t of shorter) if (longer.includes(t)) contained++
  return contained / shorter.length >= 0.66
}

// ============================================================================
// SURPRISE RANKING
// ============================================================================

/**
 * Rank the filtered upcoming candidate set for a "surprise me" pick.
 *
 * score = QUALITY * (image, !location_tba, !description_unavailable, has venue)
 *       + SOON * exp(-hours / decay)          // near future, not "the soonest"
 *       - duplicateSiblings * DUP_PENALTY     // avoid picking a series repeat
 *
 * The near-duplicate penalty is the count of sibling candidates in the same
 * venue with a near-identical title, so a single pick leans away from repeats.
 */
export function surpriseRank<T extends SearchScoreable>(
  events: T[],
  nowMs: number
): T[] {
  // Pre-compute near-duplicate sibling counts so the penalty is O(n·m) once.
  const dupSiblings = new Map<string, number>()
  for (let i = 0; i < events.length; i++) {
    let count = 0
    for (let j = 0; j < events.length; j++) {
      if (i === j) continue
      if (isNearDuplicate(events[i], events[j])) count++
    }
    dupSiblings.set(events[i].id, count)
  }

  const DUP_PENALTY = 0.5
  return [...events].sort((a, b) => {
    const sa =
      qualityScore(a) * QUALITY_WEIGHT +
      soonnessScore(a.starts_at, nowMs) * SOON_WEIGHT -
      (dupSiblings.get(a.id) ?? 0) * DUP_PENALTY
    const sb =
      qualityScore(b) * QUALITY_WEIGHT +
      soonnessScore(b.starts_at, nowMs) * SOON_WEIGHT -
      (dupSiblings.get(b.id) ?? 0) * DUP_PENALTY
    return sb - sa
  })
}

// ============================================================================
// LIST DIVERSITY (lists only, displayLimit > 1)
// ============================================================================

/**
 * Greedy, order-preserving diversity pass for lists. Preserves the relative
 * order of survivors (relevance / chronological), only *dropping* events that
 * would exceed a per-venue or per-category-signature cap, then filling from the
 * remaining ranked candidates up to `limit`.
 *
 * Counters are incremented ONLY after a candidate is accepted on ALL caps — a
 * category-rejected event must not consume venue capacity (and vice-versa).
 * Empty category signatures (`[]` / missing) are their own signature and DO
 * count toward the 3-per-signature cap.
 *
 * Accepts typed events; the generic keeps the call sites type-clean.
 */
export function applyDiversity<T extends SearchScoreable>(ranked: T[], limit: number): T[] {
  const venueCount = new Map<string, number>()
  const catCount = new Map<string, number>()
  const out: T[] = []
  for (const ev of ranked) {
    if (out.length >= limit) break
    // Only real venue values constrain — events with no venue are distinct and
    // must not be collapsed into one "anon" bucket.
    const venueKey = ev.venue_id ?? ev.venue_name
    if (venueKey) {
      const vc = venueCount.get(venueKey) ?? 0
      if (vc >= MAX_PER_VENUE) continue
    }
    // Category signature always applies; empty `[]` counts as one signature
    // (key 'none'), so a long run of unbranded events still caps at 3.
    const catKey = [...ev.categories].sort().join(',') || 'none'
    const cc = catCount.get(catKey) ?? 0
    if (cc >= MAX_PER_CATEGORY) continue
    // Every cap passed — accept now, then record its slots.
    if (venueKey) venueCount.set(venueKey, (venueCount.get(venueKey) ?? 0) + 1)
    catCount.set(catKey, (catCount.get(catKey) ?? 0) + 1)
    out.push(ev)
  }
  return out
}

/**
 * Corpus data model for the offline search relevance eval.
 *
 * A `CorpusEvent` is a minimal, raw snapshot of an event — the same shape the
 * snapshot script dumps from the live DB and the committed fixture is written
 * in. Only *raw* fields live here: no embeddings, no computed documents.
 * Phase 6 rebuilds retrieval documents from these fields.
 *
 * `facets` is intentionally loose (a hashmap keyed by facet type, e.g.
 * `{ genres: ['techno'], vibes: ['chill'], ageRestriction: '18+' }`) so it can
 * evolve without churning every fixture. It may be absent on old snapshots.
 */

export interface CorpusEventDescriptions {
  /** Primary Spanish description (the one embeddings are built from). */
  es: string | null
  /** English translation, when present. */
  en?: string | null
  /** Short summaries, when present. */
  es_summary?: string | null
  en_summary?: string | null
  /** Paragraph-preserving display text, when present. */
  es_display?: string | null
}

export interface CorpusVenue {
  /** Stable venue id (used for venue-must matching). */
  id?: string | null
  name: string | null
  neighborhood: string | null
}

export interface CorpusEvent {
  id: string
  name: string
  descriptions: CorpusEventDescriptions
  categories: string[]
  facets: Record<string, unknown>
  venue: CorpusVenue | null
  /** ISO-8601 UTC start instant. */
  starts_at: string
  is_free: boolean
  /** Price in ARS. `null` when not set / free. */
  price: number | null
  image_url: string | null
  location_tba: boolean
  time_tba: boolean
  /** Minimum age required; `null` = all ages. */
  min_age: number | null
}

/** The on-disk corpus file shape. */
export interface CorpusFile {
  meta: {
    /** 'snapshot' (live DB dump) or 'fixture' (committed synthetic set). */
    kind: 'snapshot' | 'fixture'
    generatedAt: string
    source?: string
  }
  events: CorpusEvent[]
}

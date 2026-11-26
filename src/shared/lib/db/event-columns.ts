/** Policies for physical D1 `events` columns. An omitted policy does not apply. */
interface EventColumnPolicy {
  /** The intake commit's `Catalog changed after preview` check depends on this revision boundary. */
  advancesRevision?: true
  /** The facts trigger can also restore the search document; the details trigger only restores its fields. */
  protection?: 'facts' | 'details'
  /** The scope judge reads inputs and writes judgments; it resets the invalidation timestamp on success. */
  scope?: 'input' | 'judgment' | 'invalidation'
  /** The SQLite FTS index and its maintenance triggers consume these columns. */
  fullText?: true
  /** The document builder uses these facts for search text and embeddings (venue_id supplies venue context). */
  searchDocument?: true
  /** Search reads include card columns; detail reads add credits and sale times to the search projection. */
  public?: 'card' | 'search' | 'detail'
  /** The importer selects existing rows for comparison and validates the columns it can write. */
  catalog?: 'read' | 'write' | 'read-write'
  /** Intake commit SQL names these columns when creating, or both creating and correcting, a row. */
  intakeWrite?: 'create' | 'both'
  /** Intake commits always request protection for these fields; details require explicit evidence. */
  protectOnCommit?: true
  /** Publisher fixes compare these extra fields, as well as the editable fields, before committing. */
  publisherSnapshot?: true
}

export const EVENT_COLUMN_POLICY = {
  id: { advancesRevision: true, public: 'card', catalog: 'read', intakeWrite: 'create' },
  name: { advancesRevision: true, protection: 'facts', scope: 'input', fullText: true, searchDocument: true, public: 'card', catalog: 'read-write', intakeWrite: 'both', protectOnCommit: true },
  description_display_es: { advancesRevision: true, protection: 'facts', public: 'card', catalog: 'write', intakeWrite: 'both', protectOnCommit: true },
  description_display_en: { advancesRevision: true, protection: 'facts', public: 'card', catalog: 'write', intakeWrite: 'both', protectOnCommit: true },
  description_summary_es: { advancesRevision: true, protection: 'facts', public: 'card', catalog: 'write', intakeWrite: 'both', protectOnCommit: true },
  description_summary_en: { advancesRevision: true, protection: 'facts', public: 'card', catalog: 'write', intakeWrite: 'both', protectOnCommit: true },
  starts_at: { advancesRevision: true, protection: 'facts', public: 'card', catalog: 'read-write', intakeWrite: 'both', protectOnCommit: true },
  ends_at: { advancesRevision: true, protection: 'facts', public: 'card', catalog: 'read-write', intakeWrite: 'both', protectOnCommit: true, publisherSnapshot: true },
  doors_at: { advancesRevision: true, protection: 'details', public: 'card', catalog: 'read-write', intakeWrite: 'both' },
  is_all_day: { advancesRevision: true, protection: 'facts', public: 'card', catalog: 'read-write', publisherSnapshot: true },
  time_tba: { advancesRevision: true, protection: 'facts', public: 'card', catalog: 'read-write', intakeWrite: 'both', protectOnCommit: true, publisherSnapshot: true },
  venue_id: { advancesRevision: true, protection: 'facts', scope: 'input', searchDocument: true, public: 'card', catalog: 'read-write', intakeWrite: 'both', protectOnCommit: true, publisherSnapshot: true },
  categories: { advancesRevision: true, protection: 'facts', scope: 'input', searchDocument: true, public: 'card', catalog: 'read-write', intakeWrite: 'both', protectOnCommit: true, publisherSnapshot: true },
  price: { advancesRevision: true, protection: 'facts', scope: 'input', searchDocument: true, public: 'card', catalog: 'read-write', intakeWrite: 'both', protectOnCommit: true },
  is_free: { advancesRevision: true, protection: 'facts', scope: 'input', searchDocument: true, public: 'card', catalog: 'read-write', intakeWrite: 'both', protectOnCommit: true },
  min_age: { advancesRevision: true, protection: 'facts', public: 'card', catalog: 'read-write' },
  image_url: { advancesRevision: true, protection: 'facts', public: 'card', catalog: 'read-write', intakeWrite: 'both', protectOnCommit: true },
  link: { advancesRevision: true, protection: 'facts', public: 'card', catalog: 'read-write', intakeWrite: 'create' },
  ticket_url: { advancesRevision: true, protection: 'facts', public: 'card', catalog: 'read-write', intakeWrite: 'both', protectOnCommit: true },
  status: { advancesRevision: true, protection: 'facts', public: 'card', catalog: 'read-write', intakeWrite: 'both', protectOnCommit: true },
  location_hidden: { advancesRevision: true, protection: 'facts', public: 'card', catalog: 'read-write' },
  description_es: { advancesRevision: true, protection: 'facts', scope: 'input', fullText: true, searchDocument: true, public: 'search', catalog: 'read-write', intakeWrite: 'both', protectOnCommit: true, publisherSnapshot: true },
  description_en: { advancesRevision: true, protection: 'facts', scope: 'input', searchDocument: true, public: 'search', catalog: 'read-write', intakeWrite: 'both', protectOnCommit: true, publisherSnapshot: true },
  image_width: { advancesRevision: true, protection: 'facts', public: 'search', catalog: 'read-write', intakeWrite: 'both', protectOnCommit: true },
  image_height: { advancesRevision: true, protection: 'facts', public: 'search', catalog: 'read-write', intakeWrite: 'both', protectOnCommit: true },
  source: { advancesRevision: true, protection: 'facts', scope: 'input', public: 'search', catalog: 'write', intakeWrite: 'create' },
  external_id: { advancesRevision: true, protection: 'facts', public: 'search', catalog: 'read-write', intakeWrite: 'create' },
  location_tba: { advancesRevision: true, protection: 'facts', public: 'search', catalog: 'read-write' },
  description_unavailable: { advancesRevision: true, protection: 'facts', public: 'search', catalog: 'read-write', intakeWrite: 'both' },
  enrichment_status: { advancesRevision: true, protection: 'facts', public: 'search', catalog: 'write', intakeWrite: 'both' },
  enrichment_error: { advancesRevision: true, protection: 'facts', public: 'search', catalog: 'write' },
  enriched_at: { advancesRevision: true, protection: 'facts', public: 'search', catalog: 'write' },
  created_at: { advancesRevision: true, public: 'search' },
  updated_at: { advancesRevision: true, public: 'search', publisherSnapshot: true },
  facets: { advancesRevision: true, protection: 'facts', scope: 'input', searchDocument: true, public: 'search', catalog: 'read-write', protectOnCommit: true, publisherSnapshot: true },
  search_document: { advancesRevision: true, protection: 'facts', fullText: true, catalog: 'write', intakeWrite: 'both', protectOnCommit: true, publisherSnapshot: true },
  embedding_version: { advancesRevision: true, protection: 'facts', catalog: 'read-write', intakeWrite: 'both', protectOnCommit: true, publisherSnapshot: true },
  enrichment_provenance: { advancesRevision: true, protection: 'facts', catalog: 'write' },
  organizer_name: { advancesRevision: true, protection: 'details', public: 'detail', catalog: 'read-write', intakeWrite: 'both' },
  organizer_url: { advancesRevision: true, protection: 'details', public: 'detail', catalog: 'read-write', intakeWrite: 'both' },
  performers: { advancesRevision: true, protection: 'details', public: 'detail', catalog: 'read-write', intakeWrite: 'both' },
  offers_valid_from: { advancesRevision: true, protection: 'details', public: 'detail', catalog: 'read-write', intakeWrite: 'both' },
  scope: { scope: 'judgment' },
  scope_reason: { scope: 'judgment' },
  scope_judged_at: { scope: 'judgment' },
  scope_version: { scope: 'judgment' },
  scope_invalidated_at: { scope: 'invalidation' },
} as const satisfies Record<string, EventColumnPolicy>

export type EventColumn = keyof typeof EVENT_COLUMN_POLICY
export const EVENT_COLUMNS = Object.keys(EVENT_COLUMN_POLICY) as EventColumn[]

type ColumnsWith<K extends keyof EventColumnPolicy, V> = {
  [C in EventColumn]: (typeof EVENT_COLUMN_POLICY)[C] extends Record<K, V> ? C : never
}[EventColumn]

/** Get column names for one policy without widening them to unrelated columns. */
export function eventColumnsWith<K extends keyof EventColumnPolicy, V extends NonNullable<EventColumnPolicy[K]>>(
  key: K, ...values: V[]
): ColumnsWith<K, V>[] {
  return EVENT_COLUMNS.filter((column): column is ColumnsWith<K, V> => {
    const policy: EventColumnPolicy = EVENT_COLUMN_POLICY[column]
    return values.some(value => policy[key] === value)
  })
}

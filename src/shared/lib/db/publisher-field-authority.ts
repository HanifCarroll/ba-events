import { eventColumnsWith, type EventColumn } from './event-columns.ts'

export const searchInputs = new Set<EventColumn>(eventColumnsWith('searchDocument', true))

// Include operation IDs so a second correction of the same field changes the write snapshot.
export const publisherFields = `(SELECT json_group_object(field, operation ORDER BY field) FROM publisher_field_lock WHERE event_id = events.id)`
export function publisherSet(row: Record<string, unknown> | null | undefined) {
  const locked = new Set(Object.keys(JSON.parse(typeof row?.publisher_fields === 'string' ? row.publisher_fields : '{}')))
  // Admission is one fact split across two columns. Either correction protects the whole pair from other writers.
  if (locked.has('price') || locked.has('is_free')) { locked.add('price'); locked.add('is_free') }
  return locked
}

/** Compare a proposed search input with the prevailing publisher value before calling the embedding provider. */
export function hasRefusedPublisherSearchInput(previous: Record<string, unknown> | null | undefined, patch: Partial<Record<EventColumn, unknown>>) {
  if (!previous) return false
  const locked = publisherSet(previous)
  return [...searchInputs].some(key => locked.has(key) && (previous[key] ?? null) !== (patch[key] ?? null))
}

import { eventColumnsWith, type EventColumn } from './event-columns.ts'

export const searchInputs = new Set<EventColumn>(eventColumnsWith('searchDocument', true))

// Include operation IDs so a second correction of the same field changes the write snapshot.
export const publisherFields = `(SELECT json_group_object(field, operation ORDER BY field) FROM publisher_field_lock WHERE event_id = events.id)`
export const publisherSet = (row: Record<string, unknown>) =>
  new Set(Object.keys(JSON.parse(typeof row.publisher_fields === 'string' ? row.publisher_fields : '{}')))

/** Compare a proposed search input with the prevailing publisher value before calling the embedding provider. */
export function hasRefusedPublisherSearchInput(previous: Record<string, unknown> | null | undefined, patch: Partial<Record<EventColumn, unknown>>) {
  if (!previous) return false
  const locked = publisherSet(previous)
  return [...searchInputs].some(key => locked.has(key) && (previous[key] ?? null) !== (patch[key] ?? null))
}

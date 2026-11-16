-- Events whose Vectorize vector may not match their D1 row yet (delivery PR 04). An event write that carries a new
-- embedding inserts the event's row here in the same transaction as the event update, and the row is deleted once
-- Vectorize has the new vector. A row left behind by a failed Vectorize call is re-embedded from the stored
-- search_document by the nightly reconcile (src/jobs-worker/catalog-maintenance.ts). Numbered 0003 because delivery
-- PR 03 adds 0002.
CREATE TABLE vector_sync (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  queued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', queued_at) IS queued_at)
) STRICT;

-- Keep metadata-only corrections separate from document repairs; the existing repair queue needs no backfill.
CREATE TABLE IF NOT EXISTS vector_metadata_sync (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES events(id) ON DELETE CASCADE
) STRICT;

-- D1 HTTP commits the correction and its requested index work in one statement. Older publishers omit sync.
CREATE TRIGGER IF NOT EXISTS publisher_catalog_fix_queue_vector AFTER INSERT ON publisher_catalog_fixes
BEGIN
  INSERT INTO vector_sync (event_id)
  SELECT json_extract(value, '$.id') FROM json_each(NEW.changes) WHERE json_extract(value, '$.sync') = 'document'
  ON CONFLICT (event_id) DO NOTHING;
  INSERT INTO vector_metadata_sync (event_id)
  SELECT json_extract(change.value, '$.id') FROM json_each(NEW.changes) change
  WHERE json_extract(change.value, '$.sync') = 'metadata'
    AND NOT EXISTS (SELECT 1 FROM vector_sync q WHERE q.event_id = json_extract(change.value, '$.id'))
  ON CONFLICT (event_id) DO NOTHING;
END;

-- The publisher uses one parameterized D1 HTTP statement, not a Worker D1 batch.
-- Queue the gateway's requested index work in the same statement as the existing correction trigger.
-- Older publishers omit sync; their existing stale-document and metadata reconciliation still applies.
CREATE TRIGGER IF NOT EXISTS publisher_catalog_fix_queue_vector AFTER INSERT ON publisher_catalog_fixes
BEGIN
  INSERT INTO vector_sync (event_id)
  SELECT json_extract(value, '$.id') FROM json_each(NEW.changes) WHERE json_extract(value, '$.sync') = 1
  ON CONFLICT (event_id) DO NOTHING;
END;

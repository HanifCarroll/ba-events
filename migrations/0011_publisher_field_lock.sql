-- Catalog facts are not rewritten by this migration. Backfill authority over the currently stored values.
CREATE TABLE IF NOT EXISTS publisher_field_lock (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  operation TEXT NOT NULL,
  PRIMARY KEY (event_id, field)
) STRICT;

INSERT INTO publisher_field_lock (event_id, field, operation)
SELECT event_id, field, operation FROM (
  SELECT e.id AS event_id, f.field, f.operation,
    row_number() OVER (PARTITION BY e.id, f.field ORDER BY f.applied_at DESC, f.rowid DESC) AS rank
  FROM publisher_catalog_fixes f, json_each(f.changes) c
  JOIN events e ON e.id = json_extract(c.value, '$.id')
) WHERE rank = 1
ON CONFLICT (event_id, field) DO NOTHING;

-- Open the publisher-only context before the existing receipt trigger applies its changes. A deferred FK prevents
-- an unrecognized operation from leaving any context behind, even if an INSERT skips an invalid row.
CREATE TABLE IF NOT EXISTS publisher_fix_context (
  operation TEXT PRIMARY KEY NOT NULL REFERENCES publisher_catalog_fixes(operation) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TRIGGER IF NOT EXISTS publisher_fix_open_context BEFORE INSERT ON publisher_catalog_fixes
WHEN NOT EXISTS (SELECT 1 FROM publisher_catalog_fixes WHERE operation = NEW.operation)
BEGIN
  INSERT INTO publisher_fix_context (operation) VALUES (NEW.operation);
END;

CREATE TRIGGER IF NOT EXISTS events_guard_publisher_fields BEFORE UPDATE OF
  name, starts_at, price, is_free, status, description_display_es, description_display_en,
  description_summary_es, description_summary_en ON events
WHEN NOT EXISTS (SELECT 1 FROM publisher_fix_context c JOIN publisher_catalog_fixes f USING (operation))
  AND EXISTS (SELECT 1 FROM publisher_field_lock WHERE event_id = OLD.id AND CASE field
    WHEN 'name' THEN NEW.name IS NOT OLD.name
    WHEN 'starts_at' THEN NEW.starts_at IS NOT OLD.starts_at
    WHEN 'price' THEN NEW.price IS NOT OLD.price
    WHEN 'is_free' THEN NEW.is_free IS NOT OLD.is_free
    WHEN 'status' THEN NEW.status IS NOT OLD.status AND NOT (
      OLD.status = 'scheduled' AND NEW.status = 'past' AND OLD.starts_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHEN 'description_display_es' THEN NEW.description_display_es IS NOT OLD.description_display_es
    WHEN 'description_display_en' THEN NEW.description_display_en IS NOT OLD.description_display_en
    WHEN 'description_summary_es' THEN NEW.description_summary_es IS NOT OLD.description_summary_es
    WHEN 'description_summary_en' THEN NEW.description_summary_en IS NOT OLD.description_summary_en
    ELSE 0 END)
BEGIN
  -- Abort unfiltered writes (including old Workers) before any catalog or vector queue changes can commit.
  SELECT RAISE(ABORT, 'Publisher-corrected event field is locked');
END;

-- The legacy receipt trigger clears write_context just after updating the event. Make the lock durable and close
-- the publisher override at that point, inside the same receipt INSERT. No sibling trigger ordering is needed.
CREATE TRIGGER IF NOT EXISTS publisher_fix_close_context AFTER DELETE ON write_context
WHEN EXISTS (SELECT 1 FROM publisher_fix_context)
BEGIN
  INSERT INTO publisher_field_lock (event_id, field, operation)
  SELECT e.id, f.field, f.operation FROM publisher_fix_context p
  JOIN publisher_catalog_fixes f USING (operation), json_each(f.changes) c
  JOIN events e ON e.id = json_extract(c.value, '$.id') WHERE true
  ON CONFLICT (event_id, field) DO UPDATE SET operation = excluded.operation;
  DELETE FROM publisher_fix_context;
END;

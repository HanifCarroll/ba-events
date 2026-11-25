-- A guarded publisher correction uses one parameterized INSERT through the D1 API. The trigger applies every
-- occurrence and its derived fields in that same statement, including intake's temporary write context.
CREATE TABLE publisher_catalog_fixes (
  operation TEXT PRIMARY KEY NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('description_display_es', 'description_display_en', 'description_summary_es',
    'description_summary_en', 'name', 'starts_at', 'price', 'is_free', 'status')),
  changes TEXT NOT NULL CHECK (json_valid(changes) AND json_type(changes) = 'array' AND json_array_length(changes) BETWEEN 1 AND 40),
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TRIGGER publisher_catalog_fix_apply AFTER INSERT ON publisher_catalog_fixes
BEGIN
  INSERT INTO write_context (intake_commit) VALUES (1);
  UPDATE events SET
    description_display_es = CASE WHEN NEW.field = 'description_display_es' THEN fixes.replacement ELSE events.description_display_es END,
    description_display_en = CASE WHEN NEW.field = 'description_display_en' THEN fixes.replacement ELSE events.description_display_en END,
    description_summary_es = CASE WHEN NEW.field = 'description_summary_es' THEN fixes.replacement ELSE events.description_summary_es END,
    description_summary_en = CASE WHEN NEW.field = 'description_summary_en' THEN fixes.replacement ELSE events.description_summary_en END,
    name = CASE WHEN NEW.field = 'name' THEN fixes.replacement ELSE events.name END,
    starts_at = CASE WHEN NEW.field = 'starts_at' THEN fixes.replacement ELSE events.starts_at END,
    price = CASE WHEN NEW.field = 'price' THEN fixes.replacement ELSE events.price END,
    is_free = CASE WHEN NEW.field = 'is_free' THEN fixes.replacement ELSE events.is_free END,
    status = CASE WHEN NEW.field = 'status' THEN fixes.replacement ELSE events.status END,
    search_document = fixes.document,
    embedding_version = fixes.version
  FROM (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.to') AS replacement,
    json_extract(value, '$.document') AS document, json_extract(value, '$.version') AS version FROM json_each(NEW.changes)) AS fixes
  WHERE events.id = fixes.id;
  DELETE FROM write_context;
END;

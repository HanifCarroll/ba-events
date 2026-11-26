ALTER TABLE events ADD COLUMN organizer_name TEXT;
ALTER TABLE events ADD COLUMN organizer_url TEXT;
ALTER TABLE events ADD COLUMN performers TEXT CHECK (performers IS NULL OR (json_valid(performers) AND json_type(performers) = 'array'));
ALTER TABLE events ADD COLUMN offers_valid_from TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', offers_valid_from) IS offers_valid_from);
ALTER TABLE events ADD COLUMN doors_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', doors_at) IS doors_at);

-- These details are not scope or embedding inputs, but a change must invalidate a stale intake preview.
DROP TRIGGER events_updated_at;
CREATE TRIGGER events_updated_at AFTER UPDATE OF
  id, name, starts_at, ends_at, is_all_day, venue_id, categories, price, is_free, image_url, link, ticket_url,
  source, status, created_at, updated_at, external_id, description_es, description_en, enrichment_status,
  enrichment_error, enriched_at, location_hidden, location_tba, description_unavailable, description_display_es,
  description_display_en, description_summary_es, description_summary_en, min_age, time_tba, search_document,
  facets, embedding_version, image_width, image_height, enrichment_provenance,
  organizer_name, organizer_url, performers, offers_valid_from, doors_at ON events
BEGIN
  UPDATE events SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- Separate from events_protect_intake_facts because these fields never require reverting the search document.
CREATE TRIGGER events_protect_intake_details AFTER UPDATE OF organizer_name, organizer_url, performers, offers_valid_from, doors_at ON events
WHEN NOT EXISTS (SELECT 1 FROM write_context)
BEGIN
  UPDATE events SET
    organizer_name = CASE WHEN instr(p.k, ',organizer_name,') > 0 THEN OLD.organizer_name ELSE events.organizer_name END,
    organizer_url = CASE WHEN instr(p.k, ',organizer_url,') > 0 THEN OLD.organizer_url ELSE events.organizer_url END,
    performers = CASE WHEN instr(p.k, ',performers,') > 0 THEN OLD.performers ELSE events.performers END,
    offers_valid_from = CASE WHEN instr(p.k, ',offers_valid_from,') > 0 THEN OLD.offers_valid_from ELSE events.offers_valid_from END,
    doors_at = CASE WHEN instr(p.k, ',doors_at,') > 0 THEN OLD.doors_at ELSE events.doors_at END
  FROM (
    SELECT ',' || (SELECT group_concat(value, ',') FROM json_each(fields)) || ',' AS k
    FROM event_intake_protection WHERE event_id = NEW.id
  ) AS p
  WHERE events.id = NEW.id AND (
    (instr(p.k, ',organizer_name,') > 0 AND NEW.organizer_name IS NOT OLD.organizer_name)
    OR (instr(p.k, ',organizer_url,') > 0 AND NEW.organizer_url IS NOT OLD.organizer_url)
    OR (instr(p.k, ',performers,') > 0 AND NEW.performers IS NOT OLD.performers)
    OR (instr(p.k, ',offers_valid_from,') > 0 AND NEW.offers_valid_from IS NOT OLD.offers_valid_from)
    OR (instr(p.k, ',doors_at,') > 0 AND NEW.doors_at IS NOT OLD.doors_at)
  );
END;

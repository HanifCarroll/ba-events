ALTER TABLE events ADD COLUMN scope TEXT CHECK (scope IN ('in', 'out'));
ALTER TABLE events ADD COLUMN scope_reason TEXT;
ALTER TABLE events ADD COLUMN scope_judged_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', scope_judged_at) IS scope_judged_at);
ALTER TABLE events ADD COLUMN scope_version TEXT;

-- A judgment must not invalidate an intake plan's expected event revision.
DROP TRIGGER events_updated_at;
CREATE TRIGGER events_updated_at AFTER UPDATE OF
  id, name, starts_at, ends_at, is_all_day, venue_id, categories, price, is_free, image_url, link, ticket_url,
  source, status, created_at, updated_at, external_id, description_es, description_en, enrichment_status,
  enrichment_error, enriched_at, location_hidden, location_tba, description_unavailable, description_display_es,
  description_display_en, description_summary_es, description_summary_en, min_age, time_tba, search_document,
  facets, embedding_version, image_width, image_height, enrichment_provenance ON events
BEGIN
  UPDATE events SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER events_invalidate_scope AFTER UPDATE OF name, description_es, description_en, venue_id, source, price, is_free, categories, facets ON events
WHEN OLD.scope IS NOT NULL AND (
  NEW.name IS NOT OLD.name OR NEW.description_es IS NOT OLD.description_es OR NEW.description_en IS NOT OLD.description_en
  OR NEW.venue_id IS NOT OLD.venue_id OR NEW.source IS NOT OLD.source OR NEW.price IS NOT OLD.price
  OR NEW.is_free IS NOT OLD.is_free OR NEW.categories IS NOT OLD.categories OR NEW.facets IS NOT OLD.facets
)
BEGIN
  UPDATE events SET scope = NULL, scope_reason = NULL, scope_judged_at = NULL, scope_version = NULL WHERE id = NEW.id;
END;

CREATE TRIGGER venues_invalidate_event_scope AFTER UPDATE OF name, neighborhood ON venues
WHEN NEW.name IS NOT OLD.name OR NEW.neighborhood IS NOT OLD.neighborhood
BEGIN
  UPDATE events SET scope = NULL, scope_reason = NULL, scope_judged_at = NULL, scope_version = NULL
  WHERE venue_id = NEW.id AND scope IS NOT NULL;
END;

-- Observations are versioned by content hash. An intake link can supply a caption without editing the event.
CREATE TRIGGER evidence_invalidate_event_scope AFTER INSERT ON event_source_evidence
BEGIN
  UPDATE events SET scope = NULL, scope_reason = NULL, scope_judged_at = NULL, scope_version = NULL
  WHERE id = NEW.event_id AND scope IS NOT NULL;
END;

-- Use the same snapshot for the model request and the guarded write so a concurrent edit cannot publish an old judgment.
CREATE VIEW event_scope_inputs AS
SELECT e.id, json_object(
  'name', e.name, 'descriptionEs', substr(e.description_es, 1, 1800), 'descriptionEn', substr(e.description_en, 1, 1800),
  'venue', v.name, 'barrio', v.neighborhood, 'source', e.source, 'price', e.price, 'isFree', e.is_free,
  'categories', json(e.categories), 'facets', json(e.facets), 'caption', (
    SELECT substr(o.caption, 1, 2200) FROM event_source_evidence x JOIN intake_observations o ON o.id = x.observation_id
    WHERE x.event_id = e.id ORDER BY o.observed_at DESC, o.id DESC LIMIT 1
  )
) AS input
FROM events e LEFT JOIN venues v ON v.id = e.venue_id;

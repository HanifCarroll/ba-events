-- Migration: Add location_tba to events_admin_list view
-- Events marked as "venue TBA" should not be counted as missing venue

DROP VIEW IF EXISTS events_admin_list;

CREATE VIEW events_admin_list
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.name,
  e.starts_at,
  e.venue_id,
  e.categories,
  e.source,
  e.status,
  e.link,
  e.created_at,
  e.enrichment_status,
  e.location_tba,
  -- Boolean flags instead of full text (saves ~2-10KB per event)
  (e.description_es IS NOT NULL AND e.description_es != '') AS has_description_es,
  (e.description_en IS NOT NULL AND e.description_en != '') AS has_description_en,
  -- Venue fields needed for display
  v.name AS venue_name
FROM events e
LEFT JOIN venues v ON e.venue_id = v.id;

COMMENT ON VIEW events_admin_list IS 'Lightweight view for admin event list. Excludes heavy text columns (descriptions, enrichment data) for better performance.';

-- Migration: Add lightweight events_admin_list view for admin list performance
-- This view excludes heavy columns (description_es, description_en) that aren't displayed in the list
-- and replaces them with boolean flags to indicate if descriptions exist.
-- This dramatically reduces payload size from ~2-10MB to ~200-400KB for 2000 events.

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
  -- Boolean flags instead of full text (saves ~2-10KB per event)
  (e.description_es IS NOT NULL AND e.description_es != '') AS has_description_es,
  (e.description_en IS NOT NULL AND e.description_en != '') AS has_description_en,
  -- Venue fields needed for display
  v.name AS venue_name
FROM events e
LEFT JOIN venues v ON e.venue_id = v.id;

-- Add comment explaining the view's purpose
COMMENT ON VIEW events_admin_list IS 'Lightweight view for admin event list. Excludes heavy text columns (descriptions, enrichment data) for better performance.';

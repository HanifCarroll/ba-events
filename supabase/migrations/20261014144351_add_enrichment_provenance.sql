-- Nullable for historical rows: updated_at/enriched_at do not prove source freshness.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS enrichment_provenance jsonb;
COMMENT ON COLUMN public.events.enrichment_provenance IS
  'Latest successful full/facets enrichment versions, model IDs, processing time and known description-source observation/revalidation times. Historical unknowns remain null.';

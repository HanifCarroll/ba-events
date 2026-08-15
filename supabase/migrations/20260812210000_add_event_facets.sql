-- Migration: Structured search facets on events (Phase 5)
--
--   * `events.facets` jsonb — closed-vocabulary structured attributes
--     (eventType / genres / activities / vibes / audience / setting /
--     energy / socialInteraction), extracted at enrichment and validated by
--     Zod (`eventFacetsSchema` in `src/shared/lib/search-facets.ts`).
--   * GIN index over the jsonb so later phases can filter with `@>` / `?|`
--     after the column is backfilled. Phase 5 does NOT SQL-filter on facets;
--     the enrich job fills them on first enrichment.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS facets jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS events_facets_gin ON events USING gin (facets);

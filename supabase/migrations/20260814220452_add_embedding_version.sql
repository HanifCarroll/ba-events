-- Migration: embedding_version column (Phase 6)
--
--   * `events.embedding_version int not null default 1` — records which schema
--     version produced the current `embedding`. `CURRENT_EMBEDDING_VERSION = 2`
--     in `src/shared/lib/ai/embeddings.ts`; rows below `CURRENT` (when schema 2
--     ships) are re-embed candidates for `scripts/reembed-stale.ts`.
--
--   * `search_document` is already on the table from the Phase 4 migration and
--     is written at the application layer on every embed/update (no DB trigger
--     required). This migration only adds the version column so the re-embed
--     selection predicate (`embedding_version < 2 OR search_document is null`)
--     is expressible.
--
-- Application-level writes set `embedding` + `search_document` +
-- `embedding_version` in the same UPDATE so the three can never drift apart.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS embedding_version integer NOT NULL DEFAULT 1;

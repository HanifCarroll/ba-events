-- BA Eventos baseline for Cloudflare D1: the production Supabase schema as of 2026-11-16 (supabase/migrations up to
-- 20261116180000), hand-written for SQLite. Production stays on Supabase until the cutover; this database is used by
-- tests, scripts, and the staging Worker only.
--
-- Type map (plan.md, "Target design"):
--   uuid, text            TEXT. Ids are lowercase uuid strings the app generates (crypto.randomUUID()); no SQL default.
--   timestamptz           TEXT in the exact form Date.prototype.toISOString() writes: 2026-11-16T12:00:00.000Z.
--                         Every timestamp column checks that form, so a value written another way fails loudly instead of
--                         sorting wrongly. Defaults use strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), which writes the same form.
--                         Never use datetime(): it writes "2026-11-16 12:00:00", which compares wrongly with ISO strings.
--   date                  TEXT YYYY-MM-DD.
--   jsonb, text[], uuid[] JSON TEXT checked with json_valid (arrays also with json_type = 'array').
--   enum                  CHECK (... IN (...)). event_status leaves out the retired 'cancelled' (0 rows; 'canceled' is used).
--   boolean               INTEGER 0 or 1.
--   numeric               REAL.  bigint, smallint, integer: INTEGER.
--   vector(1536)          Not stored here. Embeddings move to Vectorize (plan PR 3).
-- Not ported: auth.* and storage.* (Better Auth and R2 replace them), RLS policies and grants (server repositories
-- enforce ownership), every SQL function (later PRs port the live ones to TypeScript; the 5 unused ones are dropped),
-- full-text, trigram, GIN and ivfflat indexes (search moves to FTS5 and Vectorize in plan PR 3), and pg_cron.
-- auth.users does not exist on D1: columns that referenced it reference profiles(id) instead (every production user has
-- a profile), with the same ON DELETE rule.
--
-- SQLite triggers cannot change NEW, so the Postgres BEFORE UPDATE triggers become AFTER triggers that update the row
-- again. They rely on D1's default PRAGMA recursive_triggers = OFF: a trigger's own UPDATE never fires that trigger again,
-- but it does fire the other triggers, so each one must be a no-op on the others' writes.

-- Helpers for db.batch(), which runs its statements in one transaction.

-- Preconditions. INSERT INTO _assert (reason, ok) SELECT 'message', <condition> aborts the whole batch with `message`
-- when the condition is false; a passing row is not stored. src/shared/lib/db/d1.server.ts builds these statements.
CREATE TABLE _assert (
  reason TEXT NOT NULL,
  ok INTEGER NOT NULL CHECK (ok = 1)
) STRICT;
CREATE TRIGGER _assert_check BEFORE INSERT ON _assert
BEGIN
  SELECT CASE WHEN NEW.ok IS 1 THEN RAISE(IGNORE) ELSE RAISE(ABORT, NEW.reason) END;
END;

-- Replaces Postgres' session flag ba_events.intake_commit. While this one row exists, the intake protection trigger lets
-- protected event facts change. The intake commit batch inserts it first and deletes it last; a batch that fails rolls
-- both back. Inserting it while a forgotten row exists fails, so a stale bypass cannot go unnoticed.
CREATE TABLE write_context (
  intake_commit INTEGER PRIMARY KEY NOT NULL CHECK (intake_commit = 1)
) STRICT;

-- Users and preferences

CREATE TABLE profiles (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  locale TEXT
) STRICT;

CREATE TABLE user_preferences (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  about_me TEXT,
  preferred_categories TEXT DEFAULT '[]' CHECK (json_valid(preferred_categories) AND json_type(preferred_categories) = 'array'),
  preferred_neighborhoods TEXT DEFAULT '[]' CHECK (json_valid(preferred_neighborhoods) AND json_type(preferred_neighborhoods) = 'array'),
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at)
) STRICT;

-- Catalog

CREATE TABLE venues (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  neighborhood TEXT CHECK (neighborhood IN ('Agronomía', 'Almagro', 'Balvanera', 'Barracas', 'Belgrano', 'Boedo',
    'Caballito', 'Chacarita', 'Coghlan', 'Colegiales', 'Constitución', 'Flores', 'Floresta', 'La Boca', 'La Paternal',
    'Liniers', 'Mataderos', 'Monte Castro', 'Monserrat', 'Nueva Pompeya', 'Núñez', 'Palermo', 'Parque Avellaneda',
    'Parque Chacabuco', 'Parque Chas', 'Parque Patricios', 'Puerto Madero', 'Recoleta', 'Retiro', 'Saavedra',
    'San Cristóbal', 'San Nicolás', 'San Telmo', 'Vélez Sársfield', 'Versalles', 'Villa Crespo', 'Villa del Parque',
    'Villa Devoto', 'Villa General Mitre', 'Villa Lugano', 'Villa Luro', 'Villa Ortúzar', 'Villa Pueyrredón', 'Villa Real',
    'Villa Riachuelo', 'Villa Santa Rita', 'Villa Soldati', 'Villa Urquiza')),
  address TEXT,
  website TEXT,
  instagram_handle TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  enrichment_status TEXT NOT NULL DEFAULT 'pending' CHECK (enrichment_status IN ('pending', 'in_progress', 'completed', 'failed', 'skipped')),
  enrichment_error TEXT,
  enriched_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', enriched_at) IS enriched_at),
  parent_id TEXT REFERENCES venues(id) ON DELETE SET NULL,
  address_check_status TEXT NOT NULL DEFAULT 'pending' CHECK (address_check_status IN ('pending', 'flagged', 'confirmed_venue', 'not_flagged')),
  venue_enrichment_status TEXT NOT NULL DEFAULT 'pending' CHECK (venue_enrichment_status IN ('pending', 'complete', 'cannot_enrich'))
) STRICT;
CREATE INDEX venues_name_idx ON venues (name);
CREATE INDEX idx_venues_neighborhood ON venues (neighborhood);
CREATE INDEX idx_venues_parent_id ON venues (parent_id);
CREATE INDEX idx_venues_address_check_status ON venues (address_check_status);
CREATE INDEX idx_venues_venue_enrichment_status ON venues (venue_enrichment_status);

CREATE TABLE events (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  starts_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', starts_at) IS starts_at),
  ends_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', ends_at) IS ends_at),
  is_all_day INTEGER NOT NULL DEFAULT 0 CHECK (is_all_day IN (0, 1)),
  venue_id TEXT REFERENCES venues(id) ON DELETE SET NULL,
  categories TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(categories) AND json_type(categories) = 'array'),
  price INTEGER,
  is_free INTEGER NOT NULL DEFAULT 0 CHECK (is_free IN (0, 1)),
  image_url TEXT,
  link TEXT,
  ticket_url TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'canceled', 'postponed', 'past', 'pending_review')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  external_id TEXT,
  description_es TEXT,
  description_en TEXT,
  enrichment_status TEXT NOT NULL DEFAULT 'pending' CHECK (enrichment_status IN ('pending', 'in_progress', 'completed', 'failed', 'skipped')),
  enrichment_error TEXT,
  enriched_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', enriched_at) IS enriched_at),
  location_hidden INTEGER DEFAULT 0 CHECK (location_hidden IN (0, 1)),
  location_tba INTEGER NOT NULL DEFAULT 0 CHECK (location_tba IN (0, 1)),
  description_unavailable INTEGER NOT NULL DEFAULT 0 CHECK (description_unavailable IN (0, 1)),
  description_display_es TEXT,
  description_display_en TEXT,
  description_summary_es TEXT,
  description_summary_en TEXT,
  min_age INTEGER,
  time_tba INTEGER NOT NULL DEFAULT 0 CHECK (time_tba IN (0, 1)),
  search_document TEXT,
  facets TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(facets) AND json_type(facets) = 'object'),
  embedding_version INTEGER NOT NULL DEFAULT 1,
  image_width INTEGER CHECK (image_width > 0),
  image_height INTEGER CHECK (image_height > 0),
  enrichment_provenance TEXT CHECK (json_valid(enrichment_provenance))
) STRICT;
CREATE INDEX events_starts_at_idx ON events (starts_at);
CREATE INDEX events_status_idx ON events (status);
CREATE INDEX events_venue_id_idx ON events (venue_id);
CREATE INDEX idx_events_created_at ON events (created_at);
CREATE INDEX idx_events_status_starts_at ON events (status, starts_at) WHERE status = 'scheduled';
CREATE INDEX idx_events_is_free ON events (is_free) WHERE is_free = 1 AND status = 'scheduled';
CREATE INDEX idx_events_location_tba ON events (location_tba) WHERE location_tba = 1;
CREATE INDEX idx_events_description_unavailable ON events (description_unavailable) WHERE description_unavailable = 1;
CREATE UNIQUE INDEX events_source_external_id_unique ON events (source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE saved_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  planned_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', planned_at) IS planned_at),
  UNIQUE (user_id, event_id)
) STRICT;
CREATE INDEX idx_saved_events_user_planned_at ON saved_events (user_id, planned_at DESC);

CREATE TABLE import_blocklist (
  id TEXT PRIMARY KEY NOT NULL,
  pattern TEXT NOT NULL,
  target_field TEXT NOT NULL CHECK (target_field IN ('event_name', 'venue_name')),
  source TEXT NOT NULL CHECK (source IN ('passline', 'eventbrite', 'ba_tourism', 'meetup', 'luma', 'all')),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at)
) STRICT;
CREATE INDEX idx_import_blocklist_source ON import_blocklist (source);

CREATE TABLE scrape_runs (
  id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'partial')),
  trigger_id TEXT,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', started_at) IS started_at),
  completed_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', completed_at) IS completed_at),
  events_fetched INTEGER DEFAULT 0,
  events_inserted INTEGER DEFAULT 0,
  events_updated INTEGER DEFAULT 0,
  events_skipped INTEGER DEFAULT 0,
  venues_matched INTEGER DEFAULT 0,
  venues_auto_created INTEGER DEFAULT 0,
  venues_queued_review INTEGER DEFAULT 0,
  enrichments_completed INTEGER DEFAULT 0,
  enrichments_failed INTEGER DEFAULT 0,
  error_message TEXT,
  error_details TEXT CHECK (json_valid(error_details)),
  metadata TEXT CHECK (json_valid(metadata)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at)
) STRICT;
CREATE INDEX idx_scrape_runs_source_started ON scrape_runs (source, started_at DESC);
CREATE INDEX idx_scrape_runs_status ON scrape_runs (status);
CREATE INDEX idx_scrape_runs_started_at ON scrape_runs (started_at DESC);

CREATE TABLE venue_review_queue (
  id TEXT PRIMARY KEY NOT NULL,
  scrape_run_id TEXT REFERENCES scrape_runs(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_venue_name TEXT NOT NULL,
  source_address TEXT,
  source_coordinates TEXT CHECK (json_valid(source_coordinates)),
  source_event_ids TEXT CHECK (json_valid(source_event_ids) AND json_type(source_event_ids) = 'array'),
  best_match_venue_id TEXT REFERENCES venues(id) ON DELETE SET NULL,
  match_confidence REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', reviewed_at) IS reviewed_at),
  reviewed_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  final_venue_id TEXT REFERENCES venues(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at)
) STRICT;
CREATE INDEX idx_venue_review_queue_status ON venue_review_queue (status);
CREATE INDEX idx_venue_review_queue_source ON venue_review_queue (source);
CREATE INDEX idx_venue_review_queue_scrape_run ON venue_review_queue (scrape_run_id);
CREATE INDEX idx_venue_review_queue_created ON venue_review_queue (created_at DESC);

CREATE TABLE dismissed_venue_duplicates (
  id TEXT PRIMARY KEY NOT NULL,
  venue_id_1 TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  venue_id_2 TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  dismissed_by TEXT REFERENCES profiles(id),
  dismissed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', dismissed_at) IS dismissed_at),
  reason TEXT,
  -- Lowercase uuid strings sort the same way Postgres sorts uuids.
  CONSTRAINT venue_ids_ordered CHECK (venue_id_1 < venue_id_2),
  CONSTRAINT unique_dismissed_pair UNIQUE (venue_id_1, venue_id_2)
) STRICT;

-- Before-images the duplicate-venue merge saves (scripts/venue-duplicates.ts). No primary key, as in Postgres.
CREATE TABLE venue_merge_backup (
  merged_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', merged_at) IS merged_at),
  kind TEXT NOT NULL,
  "row" TEXT NOT NULL CHECK (json_valid("row"))
) STRICT;

-- Chat

CREATE TABLE conversations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  deleted_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at) IS deleted_at),
  metadata TEXT DEFAULT '{}' CHECK (json_valid(metadata)),
  channel TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'telegram')),
  external_identity_hash TEXT,
  -- coalesce: unlike Postgres' regex test, a NULL hash on a telegram row fails instead of passing as unknown.
  CONSTRAINT conversations_external_identity_check CHECK (coalesce(
    (channel = 'web' AND external_identity_hash IS NULL)
    OR (channel = 'telegram' AND user_id IS NULL
      AND length(external_identity_hash) = 64 AND external_identity_hash NOT GLOB '*[^0-9a-f]*'), 0))
) STRICT;
CREATE INDEX idx_conversations_user_updated ON conversations (user_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX conversations_channel_external_identity_idx ON conversations (channel, external_identity_hash);
CREATE INDEX conversations_telegram_retention_idx ON conversations (created_at) WHERE channel = 'telegram' AND deleted_at IS NULL;

CREATE TABLE messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  attached_data TEXT DEFAULT '{}' CHECK (json_valid(attached_data)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  sequence_number INTEGER NOT NULL DEFAULT 0,
  visible_content TEXT NOT NULL,
  execution_trace TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(execution_trace)),
  response_contract_version INTEGER NOT NULL DEFAULT 5,
  client_message_id TEXT,
  turn_index INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_messages_conversation_cursor ON messages (conversation_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX idx_messages_conversation_client_message_id ON messages (conversation_id, client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX idx_messages_conversation_turn_role ON messages (conversation_id, turn_index, role, id);

-- validate_assistant_message_parent: once a turn has a user message, an assistant message in that turn must name a user
-- message of the same conversation and turn as its parent.
CREATE TRIGGER messages_validate_assistant_parent_insert BEFORE INSERT ON messages
WHEN NEW.role = 'assistant' AND EXISTS (
  SELECT 1 FROM messages WHERE conversation_id = NEW.conversation_id AND role = 'user' AND turn_index = NEW.turn_index)
BEGIN
  SELECT RAISE(ABORT, 'Assistant message must reference a user parent in the same turn') WHERE NEW.parent_id IS NULL;
  SELECT RAISE(ABORT, 'Assistant parent message must reference a user message in the same turn')
  WHERE NOT EXISTS (SELECT 1 FROM messages WHERE id = NEW.parent_id AND conversation_id = NEW.conversation_id
    AND role = 'user' AND turn_index = NEW.turn_index);
END;
CREATE TRIGGER messages_validate_assistant_parent_update BEFORE UPDATE ON messages
WHEN NEW.role = 'assistant' AND EXISTS (
  SELECT 1 FROM messages WHERE conversation_id = NEW.conversation_id AND role = 'user' AND turn_index = NEW.turn_index)
BEGIN
  SELECT RAISE(ABORT, 'Assistant message must reference a user parent in the same turn') WHERE NEW.parent_id IS NULL;
  SELECT RAISE(ABORT, 'Assistant parent message must reference a user message in the same turn')
  WHERE NOT EXISTS (SELECT 1 FROM messages WHERE id = NEW.parent_id AND conversation_id = NEW.conversation_id
    AND role = 'user' AND turn_index = NEW.turn_index);
END;

CREATE TABLE chat_turns (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  assistant_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  user_client_message_id TEXT NOT NULL,
  assistant_client_message_id TEXT NOT NULL,
  content TEXT NOT NULL,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'es')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'interrupted')),
  claim_id TEXT,
  claimed_until TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', claimed_until) IS claimed_until),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  UNIQUE (conversation_id, user_client_message_id),
  UNIQUE (conversation_id, assistant_client_message_id)
) STRICT;
CREATE INDEX chat_turns_conversation_status_idx ON chat_turns (conversation_id, status, created_at);

-- Guest chats use client-generated nanoids, deliberately not foreign keys to conversations.
CREATE TABLE guest_chat_debug (
  conversation_id TEXT PRIMARY KEY NOT NULL,
  locale TEXT,
  ip TEXT,
  messages TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(messages)),
  last_user_text TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at)
) STRICT;

CREATE TABLE guest_request_lifecycle (
  request_id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'completed_with_fallback', 'errored')),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', started_at) IS started_at),
  ended_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', ended_at) IS ended_at),
  error_type TEXT,
  provider_request_id TEXT
) STRICT;
CREATE INDEX guest_request_lifecycle_started_idx ON guest_request_lifecycle (started_at) WHERE status = 'started';

CREATE TABLE telegram_updates (
  update_id INTEGER PRIMARY KEY NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  identity_hash TEXT CHECK (identity_hash IS NULL OR (length(identity_hash) = 64 AND identity_hash NOT GLOB '*[^0-9a-f]*')),
  envelope_key TEXT,
  error_code TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', received_at) IS received_at),
  completed_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', completed_at) IS completed_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  -- coalesce: a NULL hash or key fails instead of passing as unknown, as it would in Postgres.
  CHECK (coalesce(
    (status = 'completed' AND envelope_key IS NULL AND (
      (length(identity_hash) = 64 AND identity_hash NOT GLOB '*[^0-9a-f]*')
      OR (identity_hash IS NULL AND error_code IS 'identity_redacted')))
    OR (status IN ('processing', 'failed')
      AND length(identity_hash) = 64 AND identity_hash NOT GLOB '*[^0-9a-f]*'
      -- envelope_key ~ '^[A-Za-z0-9+/]{43}=$'
      AND length(envelope_key) = 44 AND substr(envelope_key, 44) = '=' AND substr(envelope_key, 1, 43) NOT GLOB '*[^A-Za-z0-9+/]*'), 0))
) STRICT;
CREATE INDEX telegram_updates_retention_idx ON telegram_updates (received_at);
CREATE INDEX telegram_updates_identity_idx ON telegram_updates (identity_hash) WHERE identity_hash IS NOT NULL;

CREATE TABLE product_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at)
) STRICT;

CREATE TABLE rate_limit_windows (
  scope TEXT NOT NULL,
  identifier_hash TEXT NOT NULL,
  window_starts_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', window_starts_at) IS window_starts_at),
  request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  PRIMARY KEY (scope, identifier_hash, window_starts_at)
) STRICT;
CREATE INDEX rate_limit_windows_updated_at_idx ON rate_limit_windows (updated_at DESC);

-- Instagram intake

CREATE TABLE intake_policy (
  id INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (id = 1),
  publishing_enabled INTEGER NOT NULL DEFAULT 0 CHECK (publishing_enabled IN (0, 1)),
  collection_enabled INTEGER NOT NULL DEFAULT 0 CHECK (collection_enabled IN (0, 1)),
  max_sources INTEGER NOT NULL DEFAULT 20 CHECK (max_sources BETWEEN 1 AND 500),
  posts_per_source INTEGER NOT NULL DEFAULT 20 CHECK (posts_per_source BETWEEN 1 AND 20),
  run_cap_usd REAL NOT NULL DEFAULT 0.35 CHECK (run_cap_usd BETWEEN 0.01 AND 5),
  monthly_cap_usd REAL NOT NULL DEFAULT 5 CHECK (monthly_cap_usd BETWEEN 0.01 AND 100),
  actor_build TEXT NOT NULL DEFAULT '0.0.679',
  data_detail_level TEXT NOT NULL DEFAULT 'detailedData' CHECK (data_detail_level IN ('basicData', 'detailedData'))
) STRICT;
-- The single policy row as the Postgres migrations leave a fresh database: collection and publishing off, the wider
-- watchlist limits of 20261114190000. The copy tool overwrites it with production's row.
INSERT INTO intake_policy (id, max_sources, run_cap_usd, monthly_cap_usd) VALUES (1, 200, 1.5, 18);

CREATE TABLE instagram_sources (
  username TEXT PRIMARY KEY NOT NULL CHECK (length(username) BETWEEN 1 AND 30 AND username NOT GLOB '*[^a-z0-9_.]*'),
  authority TEXT NOT NULL CHECK (authority IN ('organizer', 'venue', 'curator')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  qualification TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at)
) STRICT;

CREATE TABLE intake_runs (
  id TEXT PRIMARY KEY NOT NULL,
  local_date TEXT NOT NULL UNIQUE CHECK (date(local_date) IS local_date),
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'started', 'succeeded', 'failed', 'unknown')),
  reserved_usd REAL NOT NULL CHECK (reserved_usd > 0),
  charged_usd REAL CHECK (charged_usd >= 0),
  apify_run_id TEXT UNIQUE,
  dataset_id TEXT,
  input TEXT NOT NULL CHECK (json_valid(input)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  completed_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', completed_at) IS completed_at)
) STRICT;

CREATE TABLE intake_observations (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES intake_runs(id),
  post_id TEXT NOT NULL,
  source_username TEXT NOT NULL REFERENCES instagram_sources(username),
  post_url TEXT NOT NULL,
  caption TEXT NOT NULL,
  published_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', published_at) IS published_at),
  observed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', observed_at) IS observed_at),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', last_seen_at) IS last_seen_at),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  media_urls TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(media_urls)),
  reviewed_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', reviewed_at) IS reviewed_at),
  review_note TEXT,
  UNIQUE (run_id, post_id, content_hash)
) STRICT;
CREATE INDEX intake_observations_review ON intake_observations (observed_at) WHERE reviewed_at IS NULL;
CREATE INDEX intake_observations_source ON intake_observations (source_username, post_id);

CREATE TABLE intake_media (
  id TEXT PRIMARY KEY NOT NULL,
  observation_id TEXT NOT NULL REFERENCES intake_observations(id),
  position INTEGER NOT NULL CHECK (position >= 0),
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  UNIQUE (observation_id, position)
) STRICT;

CREATE TABLE intake_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at)
) STRICT;

CREATE TABLE intake_candidate_revisions (
  candidate_id TEXT NOT NULL REFERENCES intake_candidates(id),
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  PRIMARY KEY (candidate_id, revision)
) STRICT;

CREATE TABLE intake_plans (
  id TEXT PRIMARY KEY NOT NULL,
  candidate_id TEXT NOT NULL REFERENCES intake_candidates(id),
  revision INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'link', 'held')),
  -- Not a foreign key: a create plan names the event before it exists.
  event_id TEXT NOT NULL,
  expected_event_updated_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', expected_event_updated_at) IS expected_event_updated_at),
  artwork_media_id TEXT REFERENCES intake_media(id),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  evidence TEXT NOT NULL CHECK (json_valid(evidence)),
  reasons TEXT NOT NULL CHECK (json_valid(reasons)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+24 hours')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS expires_at),
  receipt TEXT CHECK (json_valid(receipt))
) STRICT;

CREATE TABLE event_source_evidence (
  event_id TEXT NOT NULL REFERENCES events(id),
  candidate_id TEXT NOT NULL REFERENCES intake_candidates(id),
  observation_id TEXT NOT NULL REFERENCES intake_observations(id),
  revision INTEGER NOT NULL,
  PRIMARY KEY (event_id, candidate_id, observation_id)
) STRICT;
CREATE INDEX event_source_evidence_candidate ON event_source_evidence (candidate_id);
CREATE INDEX event_source_evidence_observation ON event_source_evidence (observation_id);

-- fields: the event columns an accepted intake correction protects, as a JSON array of column names.
CREATE TABLE event_intake_protection (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  fields TEXT NOT NULL CHECK (json_valid(fields) AND json_type(fields) = 'array'),
  plan_id TEXT NOT NULL REFERENCES intake_plans(id),
  authority INTEGER NOT NULL,
  observed_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', observed_at) IS observed_at)
) STRICT;

-- updated_at triggers: Postgres set NEW.updated_at = now() before every update. SQLite triggers cannot change NEW, so
-- these update the row again after the statement; RETURNING still shows the value before the trigger. profiles has no
-- trigger, as in production: the app writes its updated_at itself.

CREATE TRIGGER venues_updated_at AFTER UPDATE ON venues
BEGIN
  UPDATE venues SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
CREATE TRIGGER events_updated_at AFTER UPDATE ON events
BEGIN
  UPDATE events SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
CREATE TRIGGER user_preferences_updated_at AFTER UPDATE ON user_preferences
BEGIN
  UPDATE user_preferences SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
CREATE TRIGGER import_blocklist_updated_at AFTER UPDATE ON import_blocklist
BEGIN
  UPDATE import_blocklist SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
CREATE TRIGGER venue_review_queue_updated_at AFTER UPDATE ON venue_review_queue
BEGIN
  UPDATE venue_review_queue SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
CREATE TRIGGER conversations_updated_at AFTER UPDATE ON conversations
BEGIN
  UPDATE conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- protect_intake_event_facts: every importer, enrichment, and manual write passes through here. Unless write_context
-- says an intake commit is running, an update that changes a protected column of an intake-corrected event is silently
-- reverted to the old value (kept unchanged for the cutover, DECISIONS.md). A scheduled event that has started may still
-- become past. When anything was reverted, embedding_version and search_document are restored too, so the event is not
-- re-embedded from the reverted text. The vector itself lives in Vectorize, outside this trigger.
-- A protected venue_id is never restored onto an event whose location is hidden (zz_hidden_location_has_no_venue ran
-- after this trigger in Postgres, so the hidden rule wins).
CREATE TRIGGER events_protect_intake_facts AFTER UPDATE ON events
WHEN NOT EXISTS (SELECT 1 FROM write_context)
  AND EXISTS (SELECT 1 FROM event_intake_protection WHERE event_id = NEW.id)
BEGIN
  UPDATE events SET
    name = CASE WHEN instr(p.k, ',name,') > 0 THEN OLD.name ELSE events.name END,
    starts_at = CASE WHEN instr(p.k, ',starts_at,') > 0 THEN OLD.starts_at ELSE events.starts_at END,
    ends_at = CASE WHEN instr(p.k, ',ends_at,') > 0 THEN OLD.ends_at ELSE events.ends_at END,
    is_all_day = CASE WHEN instr(p.k, ',is_all_day,') > 0 THEN OLD.is_all_day ELSE events.is_all_day END,
    venue_id = CASE WHEN events.location_hidden = 1 THEN NULL
      WHEN instr(p.k, ',venue_id,') > 0 THEN OLD.venue_id ELSE events.venue_id END,
    categories = CASE WHEN instr(p.k, ',categories,') > 0 THEN OLD.categories ELSE events.categories END,
    price = CASE WHEN instr(p.k, ',price,') > 0 THEN OLD.price ELSE events.price END,
    is_free = CASE WHEN instr(p.k, ',is_free,') > 0 THEN OLD.is_free ELSE events.is_free END,
    image_url = CASE WHEN instr(p.k, ',image_url,') > 0 THEN OLD.image_url ELSE events.image_url END,
    link = CASE WHEN instr(p.k, ',link,') > 0 THEN OLD.link ELSE events.link END,
    ticket_url = CASE WHEN instr(p.k, ',ticket_url,') > 0 THEN OLD.ticket_url ELSE events.ticket_url END,
    source = CASE WHEN instr(p.k, ',source,') > 0 THEN OLD.source ELSE events.source END,
    status = CASE WHEN instr(p.k, ',status,') > 0 AND NOT p.aged THEN OLD.status ELSE events.status END,
    external_id = CASE WHEN instr(p.k, ',external_id,') > 0 THEN OLD.external_id ELSE events.external_id END,
    description_es = CASE WHEN instr(p.k, ',description_es,') > 0 THEN OLD.description_es ELSE events.description_es END,
    description_en = CASE WHEN instr(p.k, ',description_en,') > 0 THEN OLD.description_en ELSE events.description_en END,
    enrichment_status = CASE WHEN instr(p.k, ',enrichment_status,') > 0 THEN OLD.enrichment_status ELSE events.enrichment_status END,
    enrichment_error = CASE WHEN instr(p.k, ',enrichment_error,') > 0 THEN OLD.enrichment_error ELSE events.enrichment_error END,
    enriched_at = CASE WHEN instr(p.k, ',enriched_at,') > 0 THEN OLD.enriched_at ELSE events.enriched_at END,
    location_hidden = CASE WHEN instr(p.k, ',location_hidden,') > 0 THEN OLD.location_hidden ELSE events.location_hidden END,
    location_tba = CASE WHEN instr(p.k, ',location_tba,') > 0 THEN OLD.location_tba ELSE events.location_tba END,
    description_unavailable = CASE WHEN instr(p.k, ',description_unavailable,') > 0 THEN OLD.description_unavailable ELSE events.description_unavailable END,
    description_display_es = CASE WHEN instr(p.k, ',description_display_es,') > 0 THEN OLD.description_display_es ELSE events.description_display_es END,
    description_display_en = CASE WHEN instr(p.k, ',description_display_en,') > 0 THEN OLD.description_display_en ELSE events.description_display_en END,
    description_summary_es = CASE WHEN instr(p.k, ',description_summary_es,') > 0 THEN OLD.description_summary_es ELSE events.description_summary_es END,
    description_summary_en = CASE WHEN instr(p.k, ',description_summary_en,') > 0 THEN OLD.description_summary_en ELSE events.description_summary_en END,
    min_age = CASE WHEN instr(p.k, ',min_age,') > 0 THEN OLD.min_age ELSE events.min_age END,
    time_tba = CASE WHEN instr(p.k, ',time_tba,') > 0 THEN OLD.time_tba ELSE events.time_tba END,
    search_document = OLD.search_document,
    facets = CASE WHEN instr(p.k, ',facets,') > 0 THEN OLD.facets ELSE events.facets END,
    embedding_version = OLD.embedding_version,
    image_width = CASE WHEN instr(p.k, ',image_width,') > 0 THEN OLD.image_width ELSE events.image_width END,
    image_height = CASE WHEN instr(p.k, ',image_height,') > 0 THEN OLD.image_height ELSE events.image_height END,
    enrichment_provenance = CASE WHEN instr(p.k, ',enrichment_provenance,') > 0 THEN OLD.enrichment_provenance ELSE events.enrichment_provenance END
  FROM (
    SELECT k, aged FROM (
      SELECT ',' || (SELECT group_concat(value, ',') FROM json_each(fields)) || ',' AS k,
        (OLD.status = 'scheduled' AND NEW.status = 'past' AND OLD.starts_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AS aged
      FROM event_intake_protection WHERE event_id = NEW.id
    )
    WHERE (instr(k, ',name,') > 0 AND NEW.name IS NOT OLD.name)
      OR (instr(k, ',starts_at,') > 0 AND NEW.starts_at IS NOT OLD.starts_at)
      OR (instr(k, ',ends_at,') > 0 AND NEW.ends_at IS NOT OLD.ends_at)
      OR (instr(k, ',is_all_day,') > 0 AND NEW.is_all_day IS NOT OLD.is_all_day)
      -- Clearing the venue of a hidden-location event is the hidden rule's own write, never a protected change.
      OR (instr(k, ',venue_id,') > 0 AND NEW.venue_id IS NOT OLD.venue_id AND NOT (NEW.location_hidden = 1 AND NEW.venue_id IS NULL))
      OR (instr(k, ',categories,') > 0 AND NEW.categories IS NOT OLD.categories)
      OR (instr(k, ',price,') > 0 AND NEW.price IS NOT OLD.price)
      OR (instr(k, ',is_free,') > 0 AND NEW.is_free IS NOT OLD.is_free)
      OR (instr(k, ',image_url,') > 0 AND NEW.image_url IS NOT OLD.image_url)
      OR (instr(k, ',link,') > 0 AND NEW.link IS NOT OLD.link)
      OR (instr(k, ',ticket_url,') > 0 AND NEW.ticket_url IS NOT OLD.ticket_url)
      OR (instr(k, ',source,') > 0 AND NEW.source IS NOT OLD.source)
      OR (instr(k, ',status,') > 0 AND NEW.status IS NOT OLD.status AND NOT aged)
      OR (instr(k, ',external_id,') > 0 AND NEW.external_id IS NOT OLD.external_id)
      OR (instr(k, ',description_es,') > 0 AND NEW.description_es IS NOT OLD.description_es)
      OR (instr(k, ',description_en,') > 0 AND NEW.description_en IS NOT OLD.description_en)
      OR (instr(k, ',enrichment_status,') > 0 AND NEW.enrichment_status IS NOT OLD.enrichment_status)
      OR (instr(k, ',enrichment_error,') > 0 AND NEW.enrichment_error IS NOT OLD.enrichment_error)
      OR (instr(k, ',enriched_at,') > 0 AND NEW.enriched_at IS NOT OLD.enriched_at)
      OR (instr(k, ',location_hidden,') > 0 AND NEW.location_hidden IS NOT OLD.location_hidden)
      OR (instr(k, ',location_tba,') > 0 AND NEW.location_tba IS NOT OLD.location_tba)
      OR (instr(k, ',description_unavailable,') > 0 AND NEW.description_unavailable IS NOT OLD.description_unavailable)
      OR (instr(k, ',description_display_es,') > 0 AND NEW.description_display_es IS NOT OLD.description_display_es)
      OR (instr(k, ',description_display_en,') > 0 AND NEW.description_display_en IS NOT OLD.description_display_en)
      OR (instr(k, ',description_summary_es,') > 0 AND NEW.description_summary_es IS NOT OLD.description_summary_es)
      OR (instr(k, ',description_summary_en,') > 0 AND NEW.description_summary_en IS NOT OLD.description_summary_en)
      OR (instr(k, ',min_age,') > 0 AND NEW.min_age IS NOT OLD.min_age)
      OR (instr(k, ',time_tba,') > 0 AND NEW.time_tba IS NOT OLD.time_tba)
      OR (instr(k, ',search_document,') > 0 AND NEW.search_document IS NOT OLD.search_document)
      OR (instr(k, ',facets,') > 0 AND NEW.facets IS NOT OLD.facets)
      OR (instr(k, ',embedding_version,') > 0 AND NEW.embedding_version IS NOT OLD.embedding_version)
      OR (instr(k, ',image_width,') > 0 AND NEW.image_width IS NOT OLD.image_width)
      OR (instr(k, ',image_height,') > 0 AND NEW.image_height IS NOT OLD.image_height)
      OR (instr(k, ',enrichment_provenance,') > 0 AND NEW.enrichment_provenance IS NOT OLD.enrichment_provenance)
  ) AS p
  WHERE events.id = NEW.id;
END;

-- zz_hidden_location_has_no_venue: an event whose address is shared only after registration never has a venue,
-- whichever writer sets it.
CREATE TRIGGER events_hidden_location_has_no_venue_insert AFTER INSERT ON events
WHEN NEW.location_hidden = 1 AND NEW.venue_id IS NOT NULL
BEGIN
  UPDATE events SET venue_id = NULL WHERE id = NEW.id;
END;
CREATE TRIGGER events_hidden_location_has_no_venue_update AFTER UPDATE ON events
WHEN NEW.location_hidden = 1 AND NEW.venue_id IS NOT NULL
BEGIN
  UPDATE events SET venue_id = NULL WHERE id = NEW.id;
END;

-- Views

CREATE VIEW events_with_venues AS
SELECT e.*, v.name AS venue_name, v.neighborhood AS venue_neighborhood, v.address AS venue_address
FROM events e
LEFT JOIN venues v ON e.venue_id = v.id;

CREATE VIEW events_admin_list AS
SELECT
  e.id, e.name, e.starts_at, e.venue_id, e.categories, e.source, e.status, e.link, e.created_at, e.enrichment_status,
  e.location_tba, e.description_unavailable,
  (e.description_es IS NOT NULL AND e.description_es != '') AS has_description_es,
  (e.description_en IS NOT NULL AND e.description_en != '') AS has_description_en,
  v.name AS venue_name
FROM events e
LEFT JOIN venues v ON e.venue_id = v.id;

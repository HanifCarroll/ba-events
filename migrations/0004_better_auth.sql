-- Better Auth on D1 (delivery PR 07): the tables Better Auth 1.7 reads and writes, with snake_case columns mapped in
-- src/features/auth/api/better-auth.server.ts. Production binds no D1 until the cutover, so only tests and the staging
-- Worker use these until then.
--
-- users.id is the account id everything else keys on: profiles.id, saved_events.user_id, user_preferences.user_id and
-- conversations.user_id. The import (scripts/d1-migrate/import-users.ts) keeps each Supabase auth user's UUID, so rows
-- copied from production stay attached. Better Auth writes timestamps with Date.prototype.toISOString(), the form every
-- timestamp column checks, and booleans as 0 or 1.

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  image TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at)
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS expires_at),
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at)
) STRICT;
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- One row per sign-in method. The import gives each user an `email` row (issuer `local:email`, account_id = user id);
-- Google sign-in adds a `google` row the first time, linked to the user with the same verified email.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', access_token_expires_at) IS access_token_expires_at),
  refresh_token_expires_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', refresh_token_expires_at) IS refresh_token_expires_at),
  scope TEXT,
  password TEXT,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
  UNIQUE (issuer, account_id)
) STRICT;
CREATE INDEX accounts_user_id_idx ON accounts (user_id);

-- Magic-link tokens (stored hashed) and Better Auth's OAuth state.
CREATE TABLE verification_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS expires_at),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at)
) STRICT;
CREATE INDEX verification_tokens_identifier_idx ON verification_tokens (identifier);

-- Better Auth's per-IP request limits (5 magic links a minute per address), kept in D1 so every isolate shares them.
CREATE TABLE auth_rate_limits (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  last_request INTEGER NOT NULL
) STRICT;

-- A new account gets its profile, as Supabase's auth.users trigger did. OR IGNORE: imported users already have one.
CREATE TRIGGER users_create_profile AFTER INSERT ON users
BEGIN
  INSERT OR IGNORE INTO profiles (id, email) VALUES (NEW.id, NEW.email);
END;

-- Deleting an account deletes its profile, which cascades to saved_events, user_preferences and conversations, as
-- deleting a Supabase auth user did.
CREATE TRIGGER users_delete_profile AFTER DELETE ON users
BEGIN
  DELETE FROM profiles WHERE id = OLD.id;
END;

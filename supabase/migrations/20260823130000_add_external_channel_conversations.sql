-- External chat channels reuse the existing conversation/message contract while
-- storing only an HMAC identity hash. Existing rows remain web conversations.

ALTER TABLE conversations
  ADD COLUMN channel text NOT NULL DEFAULT 'web',
  ADD COLUMN external_identity_hash text;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_channel_check
    CHECK (channel IN ('web', 'telegram')),
  ADD CONSTRAINT conversations_external_identity_check
    CHECK (
      (channel = 'web' AND external_identity_hash IS NULL)
      OR
      (
        channel = 'telegram'
        AND user_id IS NULL
        AND external_identity_hash ~ '^[0-9a-f]{64}$'
      )
    );

CREATE UNIQUE INDEX conversations_channel_external_identity_idx
  ON conversations (channel, external_identity_hash);
CREATE INDEX conversations_telegram_retention_idx
  ON conversations (created_at)
  WHERE channel = 'telegram' AND deleted_at IS NULL;

COMMENT ON COLUMN conversations.channel IS
  'Conversation transport. Existing and browser-created conversations use web.';
COMMENT ON COLUMN conversations.external_identity_hash IS
  'HMAC of a channel-scoped external identity; raw external identifiers are never stored.';

-- Recreate the transactional insert RPC so a service-role caller can insert into
-- a null-owner external conversation. FOUND distinguishes a missing row from a
-- present row whose owner is NULL. Authenticated/anonymous callers still fail
-- explicitly for NULL owners.
CREATE OR REPLACE FUNCTION insert_message_with_turn(
  p_conversation_id UUID,
  p_role TEXT,
  p_content TEXT,
  p_visible_content TEXT DEFAULT NULL,
  p_execution_trace JSONB DEFAULT '[]'::jsonb,
  p_response_contract_version SMALLINT DEFAULT 2,
  p_attached_data JSONB DEFAULT '{}'::jsonb,
  p_client_message_id TEXT DEFAULT NULL,
  p_parent_id UUID DEFAULT NULL
) RETURNS messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conversation_owner UUID;
  next_sequence INTEGER;
  assigned_turn INTEGER;
  parent_user_id UUID;
  existing_message messages%ROWTYPE;
  inserted_message messages%ROWTYPE;
BEGIN
  IF p_role NOT IN ('user', 'assistant', 'system') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  SELECT user_id
  INTO conversation_owner
  FROM conversations
  WHERE id = p_conversation_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role'
     AND (
       auth.uid() IS NULL
       OR conversation_owner IS NULL
       OR conversation_owner <> auth.uid()
     ) THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  IF p_client_message_id IS NOT NULL THEN
    SELECT *
    INTO existing_message
    FROM messages
    WHERE conversation_id = p_conversation_id
      AND client_message_id = p_client_message_id
    LIMIT 1;

    IF FOUND THEN
      RETURN existing_message;
    END IF;
  END IF;

  SELECT COALESCE(MAX(sequence_number), -1) + 1
  INTO next_sequence
  FROM messages
  WHERE conversation_id = p_conversation_id;

  IF p_role = 'user' THEN
    SELECT COALESCE(MAX(turn_index), -1) + 1
    INTO assigned_turn
    FROM messages
    WHERE conversation_id = p_conversation_id;

    parent_user_id := NULL;
  ELSIF p_role = 'assistant' THEN
    IF p_parent_id IS NOT NULL THEN
      SELECT id, turn_index
      INTO parent_user_id, assigned_turn
      FROM messages
      WHERE id = p_parent_id
        AND conversation_id = p_conversation_id
        AND role = 'user'
      LIMIT 1;

      IF parent_user_id IS NULL THEN
        RAISE EXCEPTION 'Assistant parent message must reference a user message in the same conversation';
      END IF;
    ELSE
      SELECT id, turn_index
      INTO parent_user_id, assigned_turn
      FROM messages
      WHERE conversation_id = p_conversation_id
        AND role = 'user'
      ORDER BY turn_index DESC, id DESC
      LIMIT 1;

      IF parent_user_id IS NULL THEN
        SELECT COALESCE(MAX(turn_index), -1) + 1
        INTO assigned_turn
        FROM messages
        WHERE conversation_id = p_conversation_id;
      END IF;
    END IF;
  ELSE
    SELECT COALESCE(MAX(turn_index), 0)
    INTO assigned_turn
    FROM messages
    WHERE conversation_id = p_conversation_id;

    parent_user_id := NULL;
  END IF;

  INSERT INTO messages (
    conversation_id,
    parent_id,
    client_message_id,
    role,
    content,
    visible_content,
    execution_trace,
    response_contract_version,
    attached_data,
    sequence_number,
    turn_index
  ) VALUES (
    p_conversation_id,
    parent_user_id,
    p_client_message_id,
    p_role,
    p_content,
    COALESCE(p_visible_content, p_content),
    COALESCE(p_execution_trace, '[]'::jsonb),
    COALESCE(p_response_contract_version, 2),
    COALESCE(p_attached_data, '{}'::jsonb),
    next_sequence,
    assigned_turn
  )
  RETURNING *
  INTO inserted_message;

  UPDATE conversations
  SET updated_at = NOW()
  WHERE id = p_conversation_id;

  RETURN inserted_message;
EXCEPTION
  WHEN unique_violation THEN
    IF p_client_message_id IS NOT NULL THEN
      SELECT *
      INTO existing_message
      FROM messages
      WHERE conversation_id = p_conversation_id
        AND client_message_id = p_client_message_id
      LIMIT 1;

      IF FOUND THEN
        RETURN existing_message;
      END IF;
    END IF;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION insert_message_with_turn(
  UUID, TEXT, TEXT, TEXT, JSONB, SMALLINT, JSONB, TEXT, UUID
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION insert_message_with_turn(
  UUID, TEXT, TEXT, TEXT, JSONB, SMALLINT, JSONB, TEXT, UUID
) TO authenticated, service_role;

-- Delivery claim/idempotency only. Telegram payloads and raw external ids are
-- deliberately absent.
CREATE TABLE telegram_updates (
  update_id bigint PRIMARY KEY,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  identity_hash text CHECK (identity_hash IS NULL OR identity_hash ~ '^[0-9a-f]{64}$'),
  envelope_key text,
  error_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (
      status = 'completed'
      AND envelope_key IS NULL
      AND (
        identity_hash ~ '^[0-9a-f]{64}$'
        OR (identity_hash IS NULL AND error_code = 'identity_redacted')
      )
    )
    OR (
      status IN ('processing', 'failed')
      AND identity_hash ~ '^[0-9a-f]{64}$'
      AND envelope_key ~ '^[A-Za-z0-9+/]{43}=$'
    )
  )
);

ALTER TABLE telegram_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON telegram_updates FROM anon, authenticated;
GRANT ALL ON telegram_updates TO service_role;

CREATE INDEX telegram_updates_retention_idx ON telegram_updates (received_at);
CREATE INDEX telegram_updates_identity_idx
  ON telegram_updates (identity_hash)
  WHERE identity_hash IS NOT NULL;

COMMENT ON TABLE telegram_updates IS
  'Service-role-only Telegram delivery/idempotency state; stores no raw update payloads.';
COMMENT ON COLUMN telegram_updates.identity_hash IS
  'Temporary HMAC identity link used to redact every pending/failed claim on delete; NULL after identity erasure.';
COMMENT ON COLUMN telegram_updates.envelope_key IS
  'Ephemeral base64 AES-256-GCM key. Cleared atomically on completion or identity erasure so Trigger payload history becomes undecryptable; retained only for pending/failed retry recovery.';

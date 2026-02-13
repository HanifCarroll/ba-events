-- Deterministic turn-based chat ordering and assistant->user linkage.
-- This migration:
-- 1) adds turn_index to messages
-- 2) backfills turn_index + parent_id for historical rows
-- 3) adds ordering index
-- 4) introduces transactional insert function for race-free turn assignment
-- 5) enforces assistant parent linkage via trigger validation

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS turn_index INTEGER;

DO $$
DECLARE
  conv RECORD;
  msg RECORD;
  current_turn INTEGER;
  last_user_id UUID;
BEGIN
  FOR conv IN
    SELECT id
    FROM conversations
  LOOP
    current_turn := -1;
    last_user_id := NULL;

    FOR msg IN
      SELECT id, role
      FROM messages
      WHERE conversation_id = conv.id
      ORDER BY sequence_number ASC, created_at ASC, id ASC
    LOOP
      IF msg.role = 'user' THEN
        current_turn := current_turn + 1;
        last_user_id := msg.id;

        UPDATE messages
        SET turn_index = current_turn,
            parent_id = NULL
        WHERE id = msg.id;
      ELSIF msg.role = 'assistant' THEN
        IF current_turn < 0 THEN
          current_turn := 0;
          last_user_id := NULL;
        END IF;

        UPDATE messages
        SET turn_index = current_turn,
            parent_id = last_user_id
        WHERE id = msg.id;
      ELSE
        IF current_turn < 0 THEN
          current_turn := 0;
        END IF;

        UPDATE messages
        SET turn_index = current_turn,
            parent_id = NULL
        WHERE id = msg.id;
      END IF;
    END LOOP;
  END LOOP;
END $$;

UPDATE messages
SET turn_index = COALESCE(turn_index, 0)
WHERE turn_index IS NULL;

ALTER TABLE messages
  ALTER COLUMN turn_index SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_turn_role
  ON messages(conversation_id, turn_index, role, id);

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

  SELECT user_id
  INTO conversation_owner
  FROM conversations
  WHERE id = p_conversation_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF conversation_owner IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  IF (auth.jwt() ->> 'role') <> 'service_role'
     AND (auth.uid() IS NULL OR conversation_owner <> auth.uid()) THEN
    RAISE EXCEPTION 'Conversation not found';
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

CREATE OR REPLACE FUNCTION validate_assistant_message_parent() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  matching_user_id UUID;
BEGIN
  IF NEW.role <> 'assistant' THEN
    RETURN NEW;
  END IF;

  SELECT id
  INTO matching_user_id
  FROM messages
  WHERE conversation_id = NEW.conversation_id
    AND role = 'user'
    AND turn_index = NEW.turn_index
  ORDER BY id ASC
  LIMIT 1;

  IF matching_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id IS NULL THEN
    RAISE EXCEPTION 'Assistant message must reference a user parent in the same turn';
  END IF;

  PERFORM 1
  FROM messages
  WHERE id = NEW.parent_id
    AND conversation_id = NEW.conversation_id
    AND role = 'user'
    AND turn_index = NEW.turn_index;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assistant parent message must reference a user message in the same turn';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_assistant_message_parent ON messages;

CREATE TRIGGER trg_validate_assistant_message_parent
BEFORE INSERT OR UPDATE ON messages
FOR EACH ROW
EXECUTE FUNCTION validate_assistant_message_parent();

COMMENT ON COLUMN messages.turn_index IS
  'Deterministic turn order within conversation (user turn index; assistants inherit parent user turn).';

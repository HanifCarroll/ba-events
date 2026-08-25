-- Durable, idempotent first-turn bootstrap and provider execution claim.

CREATE TABLE IF NOT EXISTS chat_turns (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  assistant_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  user_client_message_id TEXT NOT NULL,
  assistant_client_message_id TEXT NOT NULL,
  content TEXT NOT NULL,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'es')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'interrupted')),
  claim_id UUID,
  claimed_until TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, user_client_message_id),
  UNIQUE (conversation_id, assistant_client_message_id)
);

CREATE INDEX IF NOT EXISTS chat_turns_conversation_status_idx
  ON chat_turns (conversation_id, status, created_at);

ALTER TABLE chat_turns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own chat turns" ON chat_turns
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role has full access to chat turns" ON chat_turns
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE OR REPLACE FUNCTION bootstrap_chat_turn(
  p_conversation_id UUID,
  p_turn_id UUID,
  p_user_client_message_id TEXT,
  p_assistant_client_message_id TEXT,
  p_content TEXT,
  p_locale TEXT
) RETURNS chat_turns
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  owner_id UUID;
  user_message messages%ROWTYPE;
  result_turn chat_turns%ROWTYPE;
BEGIN
  IF current_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_content IS NULL OR length(trim(p_content)) = 0 OR length(p_content) > 2000
    THEN RAISE EXCEPTION 'Invalid message'; END IF;
  IF p_user_client_message_id IS NULL OR length(p_user_client_message_id) NOT BETWEEN 1 AND 128
    OR p_assistant_client_message_id IS NULL OR length(p_assistant_client_message_id) NOT BETWEEN 1 AND 128
    THEN RAISE EXCEPTION 'Invalid message id'; END IF;
  IF p_locale NOT IN ('en', 'es') THEN RAISE EXCEPTION 'Invalid locale'; END IF;

  SELECT * INTO result_turn FROM chat_turns WHERE id = p_turn_id FOR UPDATE;
  IF FOUND THEN
    IF result_turn.user_id <> current_user_id
      OR result_turn.conversation_id <> p_conversation_id
      OR result_turn.user_client_message_id <> p_user_client_message_id
      OR result_turn.assistant_client_message_id <> p_assistant_client_message_id
      OR result_turn.content <> p_content OR result_turn.locale <> p_locale
      OR result_turn.user_message_id IS NULL
    THEN RAISE EXCEPTION 'Turn conflict'; END IF;
    RETURN result_turn;
  END IF;

  INSERT INTO conversations (id, user_id)
  VALUES (p_conversation_id, current_user_id)
  ON CONFLICT (id) DO NOTHING;

  SELECT user_id INTO owner_id FROM conversations
    WHERE id = p_conversation_id AND deleted_at IS NULL FOR UPDATE;
  IF owner_id IS NULL OR owner_id <> current_user_id THEN RAISE EXCEPTION 'Turn conflict'; END IF;

  SELECT * INTO user_message FROM insert_message_with_turn(
    p_conversation_id, 'user', p_content, p_content, '[]'::jsonb, 5::SMALLINT, '{}'::jsonb,
    p_user_client_message_id, NULL::UUID
  );

  INSERT INTO chat_turns (
    id, conversation_id, user_id, user_message_id, user_client_message_id,
    assistant_client_message_id, content, locale
  ) VALUES (
    p_turn_id, p_conversation_id, current_user_id, user_message.id,
    p_user_client_message_id, p_assistant_client_message_id, p_content, p_locale
  ) RETURNING * INTO result_turn;
  RETURN result_turn;
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO result_turn FROM chat_turns
    WHERE id = p_turn_id OR (conversation_id = p_conversation_id AND user_client_message_id = p_user_client_message_id)
    LIMIT 1;
  IF FOUND AND result_turn.user_id = current_user_id
    AND result_turn.conversation_id = p_conversation_id
    AND result_turn.user_client_message_id = p_user_client_message_id
    AND result_turn.content = p_content
    AND result_turn.assistant_client_message_id = p_assistant_client_message_id
    AND result_turn.locale = p_locale
  THEN RETURN result_turn; END IF;
  RAISE EXCEPTION 'Turn conflict';
END;
$$;

CREATE OR REPLACE FUNCTION claim_chat_turn(p_turn_id UUID, p_claim_id UUID, p_retry BOOLEAN DEFAULT FALSE)
RETURNS chat_turns LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result_turn chat_turns%ROWTYPE; current_user_id UUID := auth.uid();
BEGIN
  SELECT * INTO result_turn FROM chat_turns WHERE id = p_turn_id AND user_id = current_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Turn not found'; END IF;
  IF result_turn.status = 'completed' THEN RETURN result_turn; END IF;
  IF result_turn.status = 'running' AND result_turn.claimed_until > NOW() THEN RETURN result_turn; END IF;
	IF result_turn.status = 'running' AND NOT p_retry THEN
		UPDATE chat_turns SET status = 'interrupted', updated_at = NOW() WHERE id = p_turn_id;
		SELECT * INTO result_turn FROM chat_turns WHERE id = p_turn_id;
		RETURN result_turn;
  END IF;
  IF result_turn.status IN ('failed', 'interrupted') AND NOT p_retry THEN RETURN result_turn; END IF;
  UPDATE chat_turns SET status = 'running', claim_id = p_claim_id,
    claimed_until = NOW() + INTERVAL '2 minutes', attempt_count = attempt_count + 1,
    last_error = NULL, updated_at = NOW() WHERE id = p_turn_id;
  SELECT * INTO result_turn FROM chat_turns WHERE id = p_turn_id;
  RETURN result_turn;
END;
$$;

CREATE OR REPLACE FUNCTION complete_chat_turn(
  p_turn_id UUID, p_claim_id UUID, p_assistant_client_message_id TEXT,
  p_content TEXT, p_attached_data JSONB, p_execution_trace JSONB
) RETURNS chat_turns LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result_turn chat_turns%ROWTYPE; assistant_message messages%ROWTYPE;
BEGIN
  SELECT * INTO result_turn FROM chat_turns WHERE id = p_turn_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR result_turn.claim_id <> p_claim_id
    OR result_turn.assistant_client_message_id <> p_assistant_client_message_id
  THEN RAISE EXCEPTION 'Turn claim lost'; END IF;
  IF result_turn.status = 'completed' THEN RETURN result_turn; END IF;
  SELECT * INTO assistant_message FROM insert_message_with_turn(
    result_turn.conversation_id, 'assistant', p_content, p_content,
    COALESCE(p_execution_trace, '[]'::jsonb), 5::SMALLINT, COALESCE(p_attached_data, '{}'::jsonb),
    p_assistant_client_message_id, result_turn.user_message_id
  );
  UPDATE chat_turns SET assistant_message_id = assistant_message.id, status = 'completed',
    claimed_until = NULL, updated_at = NOW() WHERE id = p_turn_id RETURNING * INTO result_turn;
  RETURN result_turn;
END;
$$;

CREATE OR REPLACE FUNCTION fail_chat_turn(p_turn_id UUID, p_claim_id UUID, p_error_code TEXT)
RETURNS chat_turns LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result_turn chat_turns%ROWTYPE;
BEGIN
  UPDATE chat_turns SET status = 'failed', claimed_until = NULL,
    last_error = CASE WHEN p_error_code IN ('execution_failed', 'persistence_failed') THEN p_error_code ELSE 'execution_failed' END,
    updated_at = NOW()
  WHERE id = p_turn_id AND user_id = auth.uid() AND claim_id = p_claim_id AND status = 'running'
  RETURNING * INTO result_turn;
  IF NOT FOUND THEN RAISE EXCEPTION 'Turn update failed'; END IF;
  RETURN result_turn;
END;
$$;

REVOKE ALL ON FUNCTION bootstrap_chat_turn(UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_chat_turn(UUID, UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_chat_turn(UUID, UUID, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION fail_chat_turn(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bootstrap_chat_turn(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION claim_chat_turn(UUID, UUID, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION complete_chat_turn(UUID, UUID, TEXT, TEXT, JSONB, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fail_chat_turn(UUID, UUID, TEXT) TO authenticated, service_role;

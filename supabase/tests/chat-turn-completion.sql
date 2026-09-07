-- Run with psql -v ON_ERROR_STOP=1 -f supabase/tests/chat-turn-completion.sql
-- against an EMPTY disposable database. Fixtures and assertions roll back together.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql AS $$
  SELECT '00000000-0000-4000-8000-000000000001'::uuid;
$$;
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT,
  attached_data JSONB
);
CREATE TABLE chat_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID DEFAULT auth.uid(),
  conversation_id UUID DEFAULT gen_random_uuid(),
  user_message_id UUID DEFAULT gen_random_uuid(),
  assistant_message_id UUID,
  assistant_client_message_id TEXT DEFAULT 'assistant',
  claim_id UUID DEFAULT gen_random_uuid(),
  status TEXT DEFAULT 'running',
  claimed_until TIMESTAMPTZ DEFAULT clock_timestamp() + interval '2 minutes',
  updated_at TIMESTAMPTZ,
  last_error TEXT
);
-- The existing message-insertion RPC is the transaction's direct dependency.
CREATE FUNCTION insert_message_with_turn(UUID, TEXT, TEXT, TEXT, JSONB, SMALLINT, JSONB, TEXT, UUID)
RETURNS messages LANGUAGE plpgsql AS $$
DECLARE result messages%ROWTYPE;
BEGIN
  IF $3 = 'storage failure' THEN RAISE EXCEPTION 'simulated storage failure'; END IF;
  INSERT INTO messages(content, attached_data) VALUES ($3, $7) RETURNING * INTO result;
  RETURN result;
END;
$$;
\ir ../migrations/20260907180000_guard_chat_turn_completion.sql

DO $$
DECLARE
  turn chat_turns%ROWTYPE;
  result chat_turns%ROWTYPE;
  blocked BOOLEAN;
  invalid_status TEXT;
BEGIN
  INSERT INTO chat_turns DEFAULT VALUES RETURNING * INTO turn;
  FOREACH invalid_status IN ARRAY ARRAY['pending', 'failed', 'interrupted', 'expired', 'missing-expiry'] LOOP
    UPDATE chat_turns SET
      status = CASE WHEN invalid_status IN ('expired', 'missing-expiry') THEN 'running' ELSE invalid_status END,
      claimed_until = CASE WHEN invalid_status = 'expired' THEN clock_timestamp() - interval '1 second'
        WHEN invalid_status = 'missing-expiry' THEN NULL ELSE clock_timestamp() + interval '2 minutes' END
      WHERE id = turn.id;
    blocked := FALSE;
    BEGIN
      PERFORM complete_chat_turn(turn.id, turn.claim_id, 'assistant', 'reply', '{"canonical":{"text":"reply"}}', '[]');
    EXCEPTION WHEN raise_exception THEN blocked := TRUE;
    END;
    ASSERT blocked, 'invalid claim completed: ' || invalid_status;
    blocked := FALSE;
    BEGIN
      PERFORM fail_chat_turn(turn.id, turn.claim_id, 'execution_failed');
    EXCEPTION WHEN raise_exception THEN blocked := TRUE;
    END;
    ASSERT blocked, 'invalid claim failed: ' || invalid_status;
    ASSERT NOT EXISTS (SELECT FROM messages), 'rejected completion saved a message';
  END LOOP;

  UPDATE chat_turns SET status = 'running', claimed_until = clock_timestamp() + interval '2 minutes' WHERE id = turn.id;
  blocked := FALSE;
  BEGIN
    PERFORM complete_chat_turn(turn.id, NULL, 'assistant', 'reply', '{}', '[]');
  EXCEPTION WHEN raise_exception THEN blocked := TRUE;
  END;
  ASSERT blocked, 'null claim completed a running turn';
  blocked := FALSE;
  BEGIN
    PERFORM complete_chat_turn(turn.id, turn.claim_id, 'other-assistant', 'reply', '{}', '[]');
  EXCEPTION WHEN raise_exception THEN blocked := TRUE;
  END;
  ASSERT blocked, 'assistant key substitution was accepted';
  blocked := FALSE;
  BEGIN
    PERFORM complete_chat_turn(turn.id, turn.claim_id, 'assistant', 'storage failure', '{}', '[]');
  EXCEPTION WHEN raise_exception THEN blocked := TRUE;
  END;
  ASSERT blocked, 'storage failure was not propagated';
  ASSERT (SELECT status = 'running' FROM chat_turns WHERE id = turn.id), 'failed save changed turn state';
  ASSERT NOT EXISTS (SELECT FROM messages), 'failed save left a reply';

  SELECT * INTO result FROM fail_chat_turn(turn.id, turn.claim_id, 'execution_failed');
  ASSERT result.status = 'failed', 'active failure was not saved';
  -- Explicit retry replaces the claim, while retaining the turn and assistant identifiers.
  UPDATE chat_turns SET status = 'running', claim_id = gen_random_uuid(), claimed_until = clock_timestamp() + interval '2 minutes'
    WHERE id = turn.id RETURNING * INTO result;
  blocked := FALSE;
  BEGIN
    PERFORM complete_chat_turn(turn.id, turn.claim_id, 'assistant', 'stale reply', '{}', '[]');
  EXCEPTION WHEN raise_exception THEN blocked := TRUE;
  END;
  ASSERT blocked, 'stale claim completed a reclaimed turn';
  turn := result;
  SELECT * INTO result FROM complete_chat_turn(turn.id, turn.claim_id, 'assistant', 'first reply', '{"canonical":{"text":"first reply"}}', '[]');
  ASSERT result.status = 'completed', 'active completion was not saved';
  ASSERT (SELECT content = 'first reply' FROM messages WHERE id = result.assistant_message_id), 'reply missing';
  PERFORM complete_chat_turn(turn.id, turn.claim_id, 'assistant', 'overwrite', '{}', '[]');
  ASSERT (SELECT count(*) = 1 FROM messages), 'replay duplicated a reply';
  ASSERT (SELECT content = 'first reply' FROM messages), 'replay replaced the reply';
  blocked := FALSE;
  BEGIN
    PERFORM complete_chat_turn(turn.id, gen_random_uuid(), 'assistant', 'stale overwrite', '{}', '[]');
  EXCEPTION WHEN raise_exception THEN blocked := TRUE;
  END;
  ASSERT blocked, 'stale completion replay was accepted';
END;
$$;
ROLLBACK;

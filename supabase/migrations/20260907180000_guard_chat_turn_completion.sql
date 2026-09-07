-- Terminal writes require the current, unexpired claim. A completed replay is read-only.
CREATE OR REPLACE FUNCTION complete_chat_turn(
  p_turn_id UUID, p_claim_id UUID, p_assistant_client_message_id TEXT,
  p_content TEXT, p_attached_data JSONB, p_execution_trace JSONB
) RETURNS chat_turns LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result_turn chat_turns%ROWTYPE; assistant_message messages%ROWTYPE;
BEGIN
  SELECT * INTO result_turn FROM chat_turns WHERE id = p_turn_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR p_claim_id IS NULL OR result_turn.claim_id IS DISTINCT FROM p_claim_id
    OR result_turn.assistant_client_message_id IS DISTINCT FROM p_assistant_client_message_id
  THEN RAISE EXCEPTION 'Turn claim lost'; END IF;
  IF result_turn.status = 'completed' THEN RETURN result_turn; END IF;
  IF result_turn.status <> 'running' OR result_turn.claimed_until IS NULL
    OR result_turn.claimed_until <= clock_timestamp()
  THEN RAISE EXCEPTION 'Turn claim lost'; END IF;
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
  WHERE id = p_turn_id AND user_id = auth.uid() AND claim_id = p_claim_id
    AND status = 'running' AND claimed_until > clock_timestamp()
  RETURNING * INTO result_turn;
  IF NOT FOUND THEN RAISE EXCEPTION 'Turn update failed'; END IF;
  RETURN result_turn;
END;
$$;

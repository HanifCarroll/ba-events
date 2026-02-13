-- Add idempotency support for message writes from client/outbox retries.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS client_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_client_message_id
  ON messages(conversation_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

COMMENT ON COLUMN messages.client_message_id IS
  'Client-generated idempotency key for message persistence retries (unique per conversation).';

-- Final-only chat response contract:
-- separate user-visible assistant text from internal execution traces.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS visible_content TEXT;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS execution_trace JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS response_contract_version SMALLINT NOT NULL DEFAULT 2;

-- Backfill existing rows so reads can switch to visible_content safely.
UPDATE messages
SET visible_content = content
WHERE visible_content IS NULL;

ALTER TABLE messages
  ALTER COLUMN visible_content SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_visible_content_search
  ON messages USING GIN (to_tsvector('english', visible_content));

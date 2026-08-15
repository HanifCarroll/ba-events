-- Server-side debug copy of guest (not signed-in) concierge chats.
-- Written by the /api/chat route via the service-role client only, so Hanif
-- can look up a broken guest chat by conversation id. The conversation_id is
-- the client-generated nanoid (not a UUID), so it is deliberately NOT a
-- foreign key to `conversations`.

CREATE TABLE guest_chat_debug (
  conversation_id text PRIMARY KEY,
  locale text,
  ip text,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_user_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE guest_chat_debug ENABLE ROW LEVEL SECURITY;
-- no policies → anon/authenticated cannot read or write

-- Per-request lifecycle for guest (not signed-in) concierge chats.
-- One row per model invocation, keyed by the client-facing request id already
-- streamed to the browser. `started` is written before the model runs; a
-- terminal `completed`/`errored` update follows. A row stuck in `started`
-- means the process died mid-request — that is the diagnostic signal, not
-- an explicit "aborted" state.
-- Written by the /api/chat route via the service-role client only, so Hanif
-- can correlate a request id to a provider request id when something breaks.
-- The conversation_id is the client-generated nanoid (not a UUID), so it is
-- deliberately NOT a foreign key to `conversations`.

CREATE TABLE guest_request_lifecycle (
  request_id text PRIMARY KEY,
  conversation_id text,
  status text NOT NULL CHECK (status IN ('started', 'completed', 'errored')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  error_type text,
  provider_request_id text
);

ALTER TABLE guest_request_lifecycle ENABLE ROW LEVEL SECURITY;
-- no policies → anon/authenticated cannot read or write

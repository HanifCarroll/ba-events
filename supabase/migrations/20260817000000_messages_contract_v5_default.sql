-- Forward-only: v5 canonical contract becomes the write default for messages.
--
-- The app and the `insert_message_with_turn` RPC always pass the version
-- explicitly, so historical rows are NOT rewritten here. This only changes the
-- column default for any direct `INSERT` that omits the column, so new rows
-- land on v5 rather than the v4 default.

ALTER TABLE messages
  ALTER COLUMN response_contract_version SET DEFAULT 5;

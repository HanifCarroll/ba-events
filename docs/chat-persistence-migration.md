# Chat Persistence and Migration (v4)

The server-produced canonical is the single authoritative stored shape. v4 is the
write default everywhere; v2/v3 rows are read-adapted, never rewritten.

## v4 write defaults

- **Authenticated** (`src/features/chat/api/agent/persist.ts`): the assistant
  message is written server-side via `addMessage` with
  `responseContractVersion = CHAT_CONTRACT_VERSION (4)`, `content =
  visible_content = canonical.text`, `executionTrace = sanitized trace`, and
  `attachedData = { canonical }` (the canonical stored verbatim). Idempotent by
  the assistant `clientMessageId`.
- **Guest** (`src/shared/lib/db/guest-conversations.ts`): `addGuestMessage`
  defaults `response_contract_version` to `CHAT_CONTRACT_VERSION` and stores
  `attached_data.canonical` verbatim (the received `data-response`, never
  reconstructed from callbacks).
- **Outbox** (`src/features/chat/lib/persistence-outbox.ts`): outbox items
  default `response_contract_version` to `CHAT_CONTRACT_VERSION` and carry the
  same `attached_data`/`execution_trace` payload, so a retried write lands on v4.

`messages.server.ts` `addMessage` also defaults `responseContractVersion` to
`CHAT_CONTRACT_VERSION` for any caller that omits it.

## v2/v3 read adapters to v4 (no row rewrites)

`src/features/chat/lib/canonical.ts` exposes version-aware adapters that produce
one strict v4 render shape. Historical rows are never rewritten:

- **v2** (`adaptV2ToCanonical`): reconstructs from `visible_content`/`content`
  and loose `attached_data.events/suggestions/directions`; `kind` is derived
  (`deriveLegacyKind`), events are normalized with `saved: null`, directions are
  runtime-filtered, and provenance is `legacy_unknown`.
- **v3** (`adaptV3ToCanonical`): adapts `attached_data.canonical`'s v3 fields to
  the v4 shape (preserving visual content), with `saved: null` on events,
  runtime-filtered directions/venue/operations/suggestions, and `legacy_unknown`
  provenance.
- **Dispatcher** (`adaptStoredMessageToCanonical`): reads the runtime
  `contractVersion` inside the persisted canonical. v4 + `isV4Canonical` returns
  the SAME object reference (identity-preserving round-trip). v3 (or null runtime
  + column `response_contract_version === 3`) adapts via `adaptV3ToCanonical`. An
  explicit unknown runtime version is always rejected (never cast as v4) and falls
  back to the v2 path; a row with no canonical also falls back to v2. The DB
  `response_contract_version` column is only a secondary signal when the runtime
  version is absent.

`isV4Canonical` is a structural guard (contract version, kind, messageKey, text,
every event's id/name/saved tri-state, directions/venue, operation outcomes,
suggestion basics, clarification shape, and every provenance field) — storage is
`unknown` JSON and is never cast as v4 without it.

## legacy_unknown provenance and saved:null / unknown identities

- Every legacy-adapted response sets `provenance.origin = 'legacy_unknown'`,
  `fallbackUsed = false`, `fallbackReason = null`, and all tool-call id arrays to
  `[]` (including `emptySourceToolCallIds`, `retainedSourceToolCallIds`,
  `stageIds`, `searchAttemptToolCallIds`).
- `saved` is `null` where a historical row cannot prove state; direction/venue
  identity that was never persisted stays absent (`venue: null` for v2; only
  runtime-validated directions/venue survive v3).

## Minimal DB default migration

`supabase/migrations/20260816130000_messages_contract_v4_default.sql` only
changes the column default:

```sql
ALTER TABLE messages
  ALTER COLUMN response_contract_version SET DEFAULT 4;
```

The app and `insert_message_with_turn` always pass the version explicitly, so
historical rows are not rewritten; this only ensures a direct `INSERT` that omits
the column lands on v4 rather than the legacy v2 default.

## One stream message / text / data-response

Each turn emits exactly one final assistant message: one `text-start`/`text-delta`/
`text-end` block (the deterministic `canonical.text`) and one persistent
`data-response` (the canonical). No work text or reasoning is emitted.

## Transient status/trace

`data-status` (id `status:<requestId>`) and `data-execution-trace` (id
`trace:<requestId>`) are `transient: true` — delivered to callbacks but not
entered into message history and not persisted. The trace is sanitized
(`buildSanitizedTrace`): tool calls/results only, embeddings stripped.

## Raw work text / reasoning absent

Work-phase prose is captured only as a bounded ephemeral note
(`WORK_TEXT_NOTE_MAX = 200`) returned by orchestration as diagnostics and never
persisted or streamed. `buildPrompt` intentionally ignores `workNotes`, so they
are never an eligibility or text authority.
Reasoning is never captured at all. The persisted `execution_trace` step `text`
is `''`; only tool calls and results are stored.

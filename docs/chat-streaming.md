# Chat Streaming and Response Contract

The chat API uses response contract **v4** — the closed canonical response. Agent
work and user-visible presentation are separate phases, and server text is
deterministic (closed `messageKey` + validated artifact facts, never model prose).

## Server phases

1. **Work loop** — up to two tool-capable `generateText` generations by default
   (`MAX_WORK_STEPS = 2`, hard cap `MAX_WORK_STEPS_HARD_CAP = 8`, single step
   enforced with `stopWhen: () => true`). Tool calls and results are appended to
   model history. Each generation's own prose is kept only as a bounded ephemeral
   work note (`WORK_TEXT_NOTE_MAX = 200`); reasoning is discarded.
2. **Finalizer** — a separate, no-tools `generateText` call with `Output.object`
   (`responsePlanSchema`) produces a closed response plan (primary kind, message
   key, artifact id references). It never runs tools and never emits free text.
3. **Validation** — `validatePlan` checks every selected id, source tool-call id,
   stage eligibility, and compound-sibling relation against the current request's
   artifact ledger.
4. **Materialization** — the server builds one `CanonicalChatResponse` from
   validated artifacts (`materializeCanonical`), or a deterministic typed fallback
   (`buildFallback`). Text comes from `materializeText` in both paths.
5. **Persistence and stream** — the same canonical object is persisted
   server-side (authenticated) or verbatim (guest) and sent to the client.

A work-generation budget can never consume the finalizer generation.

## Stream order

A successful stream emits:

```text
start
transient data-status updates        # one stable part id status:<requestId>
text-start
text-delta                           # exactly one final text block
text-end
data-response                        # exactly one persistent canonical response (v4)
transient data-execution-trace       # tool calls/results only
transient data-status(done)
finish
```

No work-loop text or reasoning is emitted. `start` always precedes status or data
chunks, including on error streams.

All status updates use one stable part ID, `status:<requestId>`, and
`transient: true`. Supported phases are:

- `thinking`
- `calling_tool`
- `finalizing`
- `validating`
- `persisting`
- `done`
- `error`

Transient status and trace parts are delivered to callbacks but do not enter
message history. `data-execution-trace` carries the sanitized trace
(`buildSanitizedTrace`) — tool calls/results only, embeddings stripped, no raw
reasoning and no work narration text.

## Canonical response

`data-response` contains the single authoritative v4 object. See
`docs/canonical-response.md` for the full schema; the shape is:

```ts
type CanonicalChatResponse = {
  contractVersion: 4
  requestId: string
  kind: ResponseKind              // 10-value closed enum
  messageKey: MessageKey          // 12-value closed enum; deterministic text source
  text: string                    // materialized server-side, never model prose
  events: CanonicalChatEventPayload[]   // tri-state `saved` on each event
  directions: DirectionsData | null
  venue: VenueDetailsData | null
  operations: OperationReceipt[]  // deterministic localized mutation receipts
  suggestions: RefinementSuggestion[]
  clarificationQuestions: ClarificationQuestion[]  // bounded fixed templates
  provenance: CanonicalProvenance // includes stage/empty/retained/attempt ids
}
```

Text and cards are siblings. Cards are materialized from validated event ids and
exact source tool-call ids; they are never inferred from prose or event-name
matching. Operation receipts render separately (their deterministic localized
`message`) — `text` never duplicates them.

The client renders text, events, directions, venue details, operation receipts,
suggestions, and clarification questions directly from this object. It does not
combine independent data callbacks.

## Loading state

`ChatContainer.svelte` maps server phases to UI states:

| Server phase | UI state |
|---|---|
| `thinking` | Thinking |
| `calling_tool` | Running tool |
| `finalizing`, `validating` | Composing |
| `persisting`, `done` | Persisting |
| `error` | Error |

The loading indicator remains visible until the canonical response provides
visible content or the request finishes. Visible content includes text, events,
directions, venue details, or operation receipts.

## Persistence and reload

- Authenticated assistant turns are persisted server-side (`persist.ts`),
  idempotently keyed by the assistant `client_message_id`. The client outbox
  retries the same canonical payload if server persistence did not land.
- Guest turns persist the received canonical object verbatim in IndexedDB.
- Version-2 and version-3 rows are adapted at read time to the v4 render shape
  (`adaptStoredMessageToCanonical`), with provenance origin `legacy_unknown` and
  `saved: null` where the historical row cannot prove state. Historical rows are
  never rewritten.
- Reloaded assistant UI messages include the persisted `data-response`,
  preserving card order and follow-up references.

## Trust boundaries

- User identity comes only from the server session.
- Tool outputs and imported event content are untrusted data.
- Event ids, directions, venue data, mutation receipts, and suggestion sources
  are validated against the current request ledger.
- Embeddings, work narration, and model reasoning never cross the client
  boundary.
- Mutations execute only in the work phase and are never inferred or retried
  from final prose. save/unsave tools are unavailable unless the latest raw user
  request has explicit save/unsave intent.

See `docs/decisions.md` ("Chat response v4: closed canonical response") and
`docs/chat-trust-boundary.md` for the trust model, and
`docs/fallback-rules.md` for deterministic fallback rules.

# Chat Streaming and Response Contract

The chat API uses response contract **v3**. Agent work and user-visible presentation are separate phases.

## Server phases

1. **Work loop** — up to two tool-capable `generateText` generations by default. Tool calls and results are appended to model history. Work text is kept only as an ephemeral finalizer note; reasoning is discarded.
2. **Finalizer** — a separate, no-tools `generateText` call with `Output.object` produces a response plan.
3. **Validation** — the server validates every selected ID and source tool-call ID against the current request's artifact ledger.
4. **Materialization** — the server creates one `CanonicalChatResponse` from validated artifacts, or a deterministic typed fallback.
5. **Persistence and stream** — the same canonical object is persisted and sent to the client.

A work-generation budget can never consume the finalizer generation.

## Stream order

A successful stream emits:

```text
start
transient data-status updates
text-start
text-delta              # exactly one final text block
text-end
data-response           # exactly one persistent canonical response
transient data-execution-trace
transient data-status(done)
finish
```

No work-loop text or reasoning is emitted. `start` always precedes status or data chunks.

All status updates use one stable part ID, `status:<requestId>`, and `transient: true`. Supported phases are:

- `thinking`
- `calling_tool`
- `finalizing`
- `validating`
- `persisting`
- `done`
- `error`

Transient status and trace parts are delivered to callbacks but do not enter message history.

## Canonical response

`data-response` contains the single authoritative object:

```ts
type CanonicalChatResponse = {
  contractVersion: 3
  requestId: string
  kind:
    | 'recommendations'
    | 'event_details'
    | 'saved_events'
    | 'directions'
    | 'venue_details'
    | 'mutation_result'
    | 'clarification'
    | 'no_results'
    | 'out_of_scope'
    | 'error'
  text: string
  events: ChatEventPayload[]
  directions: DirectionsData | null
  venue: VenueDetailsData | null
  operations: OperationReceipt[]
  suggestions: RefinementSuggestion[]
  provenance: CanonicalProvenance
}
```

Text and cards are siblings. Cards are materialized from validated event IDs and exact source tool-call IDs; they are never inferred from prose.

The client renders text, events, directions, venue details, operation receipts, and suggestions directly from this object. It does not combine independent data callbacks.

## Loading state

`ChatContainer.svelte` maps server phases to UI states:

| Server phase | UI state |
|---|---|
| `thinking` | Thinking |
| `calling_tool` | Running tool |
| `finalizing`, `validating` | Composing |
| `persisting`, `done` | Persisting |
| `error` | Error |

The loading indicator remains visible until the canonical response provides visible content or the request finishes. Visible content includes text, events, directions, venue details, or operation receipts.

## Persistence and reload

- Authenticated assistant turns are persisted server-side, idempotently keyed by client message ID. The client outbox retries the same canonical payload if server persistence did not land.
- Guest turns persist the received canonical object verbatim in IndexedDB.
- Version-2 messages are adapted at read time from `visible_content` and legacy attachments, with provenance origin `legacy_unknown`. Historical rows are not rewritten.
- Reloaded assistant UI messages include the persisted `data-response`, preserving card order and follow-up references.

## Trust boundaries

- User identity comes only from the server session.
- Tool outputs and imported event content are untrusted data.
- Event IDs, directions, venue data, mutation receipts, and suggestion sources are validated against the current request ledger.
- Embeddings, work narration, and model reasoning never cross the client boundary.
- Mutations execute only in the work phase and are never inferred or retried from final prose.

See `docs/decisions.md` (“Chat response v3: canonical response + phase separation”) for fallback and migration rules.

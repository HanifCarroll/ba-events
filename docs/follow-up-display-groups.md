# Follow-up Display Groups and Stable Handles

Follow-up reference resolution ("the second one", "that", "the Niceto one") is
handled by the bounded **ToolLoopAgent** against server-rehydrated prior
context. Source: `src/features/chat/api/agent/follow-up.ts` (grouping +
rehydration + handles) and `orchestrate.ts` (agent prompt + validation).

## Group shape and bounds

Prior displayed events are `PriorDisplayGroup[]` — one group per result-bearing
assistant response — not a flat deduped list, so "the second one" resolves
against the newest response exactly as the user saw it.

```ts
export interface PriorDisplayGroup {
  assistantMessageId: string
  requestId: string
  createdAt: string | null
  events: PriorDisplayEvent[]   // { eventId, displayIndex, name, saved }
}
```

Bounds (all in `follow-up.ts`):

| Constant | Value | Meaning |
|---|---|---|
| `MAX_PRIOR_GROUPS` | 6 | newest groups kept |
| `MAX_PRIOR_EVENTS` | 20 | total event occurrences kept (oldest dropped first) |
| `MAX_HISTORY_MESSAGES` | 50 | newest assistant messages inspected |
| `MAX_HINT_EVENTS` | 50 | events accepted per untrusted hint |
| `MAX_HINT_OPERATIONS` | 20 | operations accepted per untrusted hint |
| `MAX_REHYDRATE_IDS` | 100 | distinct ids submitted to the rehydration query |
| `MAX_ID_STRING` / `MAX_NAME_STRING` | 128 / 200 | string caps |

`DISPLAYABLE_EVENT_STATUSES` is `['scheduled', 'past']` — cancelled/postponed/
pending_review events are discarded and never offered as follow-up targets.

## Stable handles

Each displayed event gets a server-owned handle derived from the persisted
canonical's `requestId` + original display position:

```ts
handleFor(requestId, index) => `${requestId}:event_${index}`
```

Existing v5 ordered event IDs already persist this mapping (the canonical stores
`requestId` + ordered `events`), so no wire bump is needed. The agent prompt lists `responseOrder`, `displayOrder`, handles, and facts.
The server resolves handles against the exact server-issued map; an unknown
handle fails closed. Same-turn results receive opaque refs for later calls;
raw event UUIDs remain in the server artifact ledger.

## Rehydration

`buildPriorContext` re-fetches event ids from the DB (one bounded query),
discards non-displayable/missing events without renumbering surviving display
positions, and stamps the final saved state. An
empty-events response (e.g. a clarification) creates no group and never moves
the ordinal window.

## Saved evidence

Authenticated history is stamped from the authoritative saved-membership query
(a `complete` result marks absent ids `saved:false`; `unavailable` leaves `null`).
Guest history never trusts client `saved`/operation outcomes — rehydrated events
default to `null`. The chat turn itself performs zero mutations, so there is no
intra-turn saved chronology to reconcile.

# Bounded Concierge Architecture

The BA Events concierge is a finite conversational workflow, not a general-purpose agent.

```text
latest user request + bounded server state
                  ↓
one generateText call + Output.object(TurnPlan)
                  ↓
        deterministic executor
                  ↓
       canonical response → UI
```

## Planner

`src/features/chat/api/agent/planner.ts` defines the closed `TurnPlan` union. The planner:

- interprets English and Spanish;
- receives only the latest request, bounded prior-event handles and facts, and optional pinned-event facts;
- returns one search, one prior/pinned action, a saved-events read, a clarification, or out-of-scope;
- has no tools and no visible-prose field;
- runs exactly once on a normal turn.

Unsupported or conflicting compounds clarify. There is no model repair pass.

## Executor

`src/features/chat/api/agent/executor.ts` validates the plan against server-owned state and calls the existing read implementations directly:

- `search_events`;
- `get_event_details`;
- `get_directions`;
- `get_venue_details`;
- `list_saved_events`.

A turn performs at most one search and one related read, or one prior/pinned/saved-events read. The executor builds the canonical response and localized text deterministically.

## Stable event targeting

Displayed events use handles derived from the persisted response id and original display position:

```text
<requestId>:event_<zero-based-position>
```

Prior event IDs are parsed from persisted canonicals, re-fetched from Supabase, and mapped to these handles. The planner returns a handle; the executor accepts it only when it exists in the rehydrated map. Current-search actions use an index validated against the actual ordered results. The model never returns an event UUID.

## Save and unsave

Chat text never mutates saved events. Save/unsave requests return the exact event card with a deterministic instruction to use its existing Save/Remove control. The existing UI button and authenticated Supabase path remain the only mutation surface.

## Preserved boundaries

- Existing constrained semantic retrieval, ranking, and suggestions.
- Canonical `data-response` rendering and historical read adapters.
- One assistant message with one text block and one canonical response.
- Auth, persistence, rate limits, telemetry, and a reads-only execution trace.
- Pinned-event validation and authoritative saved membership for prior events.

See also: [`canonical-response.md`](./canonical-response.md), [`chat-streaming.md`](./chat-streaming.md), and [`chat-trust-boundary.md`](./chat-trust-boundary.md).

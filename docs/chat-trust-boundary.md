# Chat Trust Boundary

Every input the model can see is server-owned, or reduced to untrusted data
carrying handles/order/facts only. The model never receives an event UUID, and
no prompt wording is relied on for enforcement — the executor validates
handles/indexes deterministically.

## Static planner system

`PLANNER_SYSTEM` (`src/features/chat/api/agent/planner.ts`) is static. Pinned
and prior facts are placed only in the bounded user prompt, never interpolated
into the system prompt.

## Prior/pinned context in the planner prompt

The planner prompt carries ONLY bounded, server-rehydrated state:

- Prior displayed events as `responseOrder + displayOrder + handle + facts`,
  where the handle is `requestId:event_N` (derived server-side from the
  persisted canonical's `requestId` + original display order). The planner must return the exact
  handle; it never sees or returns a raw event UUID.
- The pinned event's name + venue, when one is showing (so the planner can map
  a target-less action to `pinned_event_action`).

Names are rehydrated from the DB (server-owned facts), never client input, and
are framed as DATA. The planner returns only a closed `TurnPlan` — no free text
field exists to smuggle prose or instructions back out.

## Deterministic validation (not prompt-enforced)

The executor (`runExecutor`) validates every plan reference against the actual
state:

- `prior_event_action.targetHandle` must exactly equal a server-issued handle;
  otherwise clarification.
- `search.followUp.resultIndex` must be within the actual ordered result list;
  otherwise clarification.
- `pinned_event_action` uses only the server-resolved pin (`pin.eventId` /
  `pin.venueId`).

Save/unsave are structurally impossible: `ExecutorTools` has no mutation
surface, and the canonical's `operations` is always empty.

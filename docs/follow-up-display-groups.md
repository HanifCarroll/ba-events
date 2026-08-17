# Follow-up Display Groups (v4)

Follow-up reference resolution ("the second one", "save that", "the Niceto one")
is deterministic, built from grouped prior context. Source:
`src/features/chat/api/agent/follow-up.ts` (grouping + rehydration) and
`src/features/chat/api/agent/context.ts` (reference resolution).

## Group shape and bounds

Prior displayed events are `PriorDisplayGroup[]` — one group per result-bearing
assistant response — not a flat deduped list, so ordinals resolve against the
newest response exactly as the user saw it.

```ts
export interface PriorDisplayGroup {
  assistantMessageId: string
  requestId: string
  createdAt: string | null
  events: PriorDisplayEvent[]   // { eventId, name, saved }
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

## Ordinals use the newest card-bearing response

`resolveReferences` detects EN ordinals (`first`…`fifth`) and ES ordinals
(`primero`…`quinto`), then indexes `newest.events[ordinal]` where `newest` is the
last (newest) group. An ordinal out of range for the newest group yields nothing
— it does not fall through to older groups.

## Mutation-only responses don't move the window

`buildPriorContext` skips a response whose `events` array is empty — even if it
carried operations. A save/unsave-only turn therefore creates no group and never
changes which response the ordinals/pronouns point at.

## Repeated events preserve order

Groups are built in response order and each group's events keep their hint order.
Deduping happens only at the id-collection stage (`collectEventIds`); within a
group, an event repeated across responses keeps its per-group position, and the
same event id can legitimately appear in multiple groups (each occurrence is
stamped with the final saved state).

## Pronouns: lead event first, "other" second

- `PRONOUNS` ("it", "this one", "that", "ese/esa/eso", …) → `newest.events[0]`
  (the lead card).
- `OTHER_PRONOUNS` ("other", "the other", "otro/otra") → `newest.events[1]` (the
  second displayed / "other" card), when present.

Both operate on the newest group only.

## Named older references

`resolveNamed` matches the query against event names, newest group first, then
venue names, newest group first. A name match returns that event's id (and venue
id when known). This is the only path that searches across older groups; ordinals
and pronouns are newest-group-only. Names come from rehydrated DB facts, never
from untrusted hint text.

## Saved evidence chronology

Tri-state saved is resolved chronologically across the turn:

- `mutationSavedState`: `applied`/`already_applied` save → `true`; unsave →
  `false`; `denied`/`unauthenticated`/`not_found`/`failed` → `null` (no overwrite).
- In `buildPriorContext`, operations are applied first (chronologically), then
  each hint event's non-null `saved` is applied, then the final state is stamped
  onto every occurrence of that event across all groups.
- Within a single request, `resolveSavedState` (`record.ts`) walks the ledger in
  `(stepIndex, callIndex)` order; the latest successful `check_event_saved` /
  save / unsave evidence wins; failed/denied/unauthenticated/not-found never
  overwrite a prior known value.

A successful save in a later mutation-only response therefore stamps `saved:
true` onto the same event's earlier card group.

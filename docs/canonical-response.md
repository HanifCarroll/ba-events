# Canonical Response and Turn Plan Schema

The v5 canonical is **closed**: server text is deterministic and the planner's
`TurnPlan` has no free-text field. Everything user-visible is derived
server-side from a closed `messageKey` plus validated artifacts. There is no
mutation: the `operations` array is always empty, and the mutation-related
`messageKey`s remain only for rendering historical rows.

Source of truth for the types: `src/shared/lib/types.ts`. The planner schema:
`src/features/chat/api/agent/planner.ts`. The deterministic executor:
`src/features/chat/api/agent/executor.ts`. Text materialization:
`src/features/chat/api/agent/materialize.ts`.

## TurnPlan (closed, discriminated)

```ts
type TurnPlan =
  | { kind: 'search'; search: SearchEventsInput; count: 1..5;
      followUp: null | { action: FollowUpAction; resultIndex: 0..4 } }
  | { kind: 'prior_event_action'; action: FollowUpAction; targetHandle: string }
  | { kind: 'pinned_event_action'; action: FollowUpAction }
  | { kind: 'list_saved'; filter: 'upcoming' | 'past' | 'all' }
  | { kind: 'clarification'; question: ClarificationKey }
  | { kind: 'out_of_scope' }

type FollowUpAction =
  | 'event_details' | 'directions' | 'venue_details'
  | 'show_for_save' | 'show_for_unsave'
```

The union and nested objects are strict: unknown fields, free prose, and
model-supplied event-ID fields are rejected. `search` reuses the strict existing
`searchEventsInputSchema`; `count` is the server-applied display limit (the
executor sets `search.limit = count`). Unsupported/conflicting compounds are
planned as `clarification`.

## Strict canonical schema

```ts
export const CHAT_CONTRACT_VERSION = 5 as const

export type ResponseKind =
  | 'recommendations' | 'event_details' | 'saved_events' | 'directions'
  | 'venue_details' | 'mutation_result' | 'clarification' | 'no_results'
  | 'out_of_scope' | 'error'
```

`messageKey`, `clarificationQuestions`, and every provenance array are required.
The executor fills only what a bounded turn needs; the remaining provenance
fields (`retainedSourceToolCallIds`, `stageIds`, `mutationToolCallIds`, …) are
compatibility-only and stay empty rather than retaining lifecycle machinery.

## New deterministic leads

- `use_save_control` / `use_unsave_control` (kind `event_details`) — the
  show-for-save/unsave card message pointing to Save or Remove from saved.
- `login_required` (kind `saved_events`) — an unauthenticated list-saved turn.

The mutation keys (`mutation_applied`, …) and `share_guidance` are retained
only so historical rows keep their text; the executor never emits them.

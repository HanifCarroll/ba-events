# Canonical Response and Finalizer Schema (v5)

The v5 canonical is **closed**: server text is deterministic and the finalizer
plan has no free-text field. Everything user-visible is derived server-side from
a closed key plus validated artifact facts. Mutations are **planned
deterministically during validation**, cross-checked against the finalizer's
proposal, and executed exactly once by a server-side executor.

Source of truth for the types: `src/shared/lib/types.ts`. The finalizer schema:
`src/features/chat/api/agent/finalizer.ts`. Text materialization:
`src/features/chat/api/agent/materialize.ts`. Mutation planning/execution:
`src/features/chat/api/agent/mutation.ts`.

## Strict canonical schema

```ts
export const CHAT_CONTRACT_VERSION = 5 as const

export type ResponseKind =
  | 'recommendations' | 'event_details' | 'saved_events' | 'directions'
  | 'venue_details' | 'mutation_result' | 'clarification' | 'no_results'
  | 'out_of_scope' | 'error'

export const MESSAGE_KEYS = [
  'recommendations', 'recommendations_pick', 'event_details', 'saved_events',
  'directions', 'venue_details', 'clarification', 'no_results', 'out_of_scope',
  'share_guidance', 'error',
  'mutation_applied', 'mutation_already_applied', 'mutation_unauthenticated',
  'mutation_not_found', 'mutation_failed', 'mutation_mixed',
  'partial_results', 'pinned_event_unavailable',
] as const
export type MessageKey = (typeof MESSAGE_KEYS)[number]

export interface CanonicalChatResponse {
  contractVersion: typeof CHAT_CONTRACT_VERSION
  requestId: string
  kind: ResponseKind
  messageKey: MessageKey
  text: string
  events: CanonicalChatEventPayload[]
  directions: DirectionsData | null
  venue: VenueDetailsData | null
  operations: OperationReceipt[]
  suggestions: RefinementSuggestion[]
  clarificationQuestions: ClarificationQuestion[]
  provenance: CanonicalProvenance
}
```

### Closed primaryKind / messageKey

- `kind` is the 10-value `ResponseKind` enum.
- `messageKey` is the 19-value `MESSAGE_KEYS` enum. Two keys map to
  `recommendations` (`recommendations`, `recommendations_pick`); the outcome-aware
  mutation keys (`mutation_applied` … `mutation_mixed`) all map to
  `mutation_result`; `partial_results` maps to `recommendations`;
  `pinned_event_unavailable` maps to `error`; `share_guidance` maps to
  `out_of_scope`. `MESSAGE_KEY_KIND` (in `materialize.ts`) is the authoritative
  kind↔key mapping; the validator rejects (`invalid_message_key`) any key whose
  kind does not match `kind`.
- The finalizer's `primaryKind` is the same `ResponseKind` enum. It only ever
  proposes the neutral `mutation_mixed` placeholder for a mutation-result
  primary — the truthful outcome-aware key is derived server-side after
  execution.

### Exact artifact refs

- `EventSelection = { eventId: string; sourceToolCallId: string }` binds every
  selected event to the exact tool call that produced it. Validation re-resolves
  each id against that source artifact (same `requestId`, succeeded, contains the
  id); a wrong source kind or a missing/mismatched id is a typed failure
  (`invalid_source_tool_call`, `inconsistent_response_kind`,
  `unknown_event_id`).
- `directionsToolCallId` / `venueToolCallId` / `suggestionSourceToolCallId` /
  `emptySourceToolCallIds` are exact ledger tool-call ids, validated for kind,
  success, and request identity.
- `operationToolCallIds` is retained in the schema for compatibility but does not
  authorize a mutation. It must be empty in v5 plans; receipts are created
  server-side only after the planned mutation passes validation.

### Empty-source refs

`emptySourceToolCallIds` grounds a `no_results` response. A valid empty source is
either an active `search` entry with `zeroResults` or a `saved-events` entry with
`zeroResults`. `no_results` with no empty ids fails (`invalid_empty_source`), as
does any empty id that is not such a source. **Search grounding is valid only when
`activeStage.outcome === 'empty'`.** `partial_failure` (a parallel stage with one
success-empty and one failed call) can never support `no_results` — it is rejected
with `no_results`, as are `success` and `partial_success`. A failed-only stage is
rejected via `invalid_empty_source`.

### Fixed clarification keys

```ts
export const CLARIFICATION_KEYS = [
  'which_event', 'which_day', 'which_time', 'which_neighborhood',
  'which_category', 'which_venue', 'budget',
] as const
export interface ClarificationQuestion {
  key: ClarificationKey
  label: string   // localized, materialized server-side from the key
}
```

At most two questions (`max(2)` in the schema; re-checked by the validator). They
carry no artifact facts — only the fixed template key and its localized label.
If the finalizer supplies none for a clarification response, validation inserts
the deterministic `which_category` default. `materializeClarificationText` joins
the validated labels into the single streamed `canonical.text` block.

### No arbitrary text

`text` is never model prose. It is produced by `materializeText({ messageKey,
locale, eventName?, directionsVenueName?, venueName? })` from a closed
`TEXTS` table. The only interpolated values are sanitized names
(`cleanName`: control chars stripped, whitespace collapsed, capped at 80) for
`event_details` / `directions` / `venue_details` leads. Every other key returns
the exact localized template string.

## Finalizer schema (responsePlanSchema)

```ts
export const PLAN_REASONS = ['empty_search', 'empty_saved_events'] as const

export const responsePlanSchema = z.object({
  contractVersion: z.literal(5),
  primaryKind: z.enum(RESPONSE_KINDS),
  messageKey: z.enum(FINALIZER_MESSAGE_KEYS),
  eventSelections: z.array(z.object({
    eventId: z.string().min(1),
    sourceToolCallId: z.string().min(1),
  })).max(5),
  directionsToolCallId: z.string().nullable(),
  venueToolCallId: z.string().nullable(),
  suggestionSourceToolCallId: z.string().nullable(),
  operationToolCallIds: z.array(z.string()).max(5),
  emptySourceToolCallIds: z.array(z.string()).max(5),
  clarificationQuestions: z.array(z.object({ key: z.enum(CLARIFICATION_KEYS) })).max(2),
  plannedMutations: z.array(z.object({
    action: z.enum(['save', 'unsave']),
    eventId: z.string().min(1),
    source: z.object({
      kind: z.enum(['resolved_prior_target', 'pinned_event', 'selected_current_event']),
      sourceToolCallId: z.string().optional(),
    }),
  })).max(1).default([]),
  reason: z.enum(PLAN_REASONS).nullable(),
})
```

- `reason` is an optional closed informational marker (`empty_search` /
  `empty_saved_events`), never prose and never an eligibility authority.
- `operationToolCallIds` must be empty. The finalizer runs before post-plan
  execution, so no mutation receipt exists for it to reference.
- The finalizer runs with `temperature: 0` and `NO_THINKING`, producing this
  object via `Output.object({ schema: responsePlanSchema })`. It never runs tools
  and never parses free-form JSON. `NoOutputGeneratedError` /
  `NoObjectGeneratedError` become `invalid_schema`; any other throw becomes
  `finalizer_error` — both are deterministic-fallback triggers.

## Deterministic mutation contract (v5)

The work loop **never** executes save/unsave. During validation, the server
derives the single authorized mutation target deterministically (`planMutation`)
and cross-checks the finalizer's `plannedMutations` proposal against it. Assembly
then executes that already-validated plan exactly once (`executeMutations`).

- **No mutation intent** ⇒ `plannedMutations` MUST be exactly empty. Any proposal
  fails `mutation_target_mismatch`.
- **Resolved intent** ⇒ exactly ONE proposal, exactly matching the deterministic
  plan (action, eventId, source kind, and — for `selected_current_event` — the
  source tool call id). An omitted or mismatched proposal fails
  `mutation_target_mismatch`.
- **Ambiguous intent** ⇒ zero mutation and a clarification response. A proposal
  alongside an ambiguous target fails `ambiguous_mutation_target`.
- **`mutation_result` is invalid unless a mutation is actually planned** — a
  `mutation_result` primary with no resolved planned mutation fails
  `invalid_mutation_ref`.

Validation returns the already-validated `PlannedMutation` (plus a
`mutationStatus` of `none` / `ambiguous` / `resolved`); the assemble step executes
that carried mutation and does **not** re-plan. The truthful outcome-aware
mutation message key (`mutation_applied`, `mutation_already_applied`,
`mutation_unauthenticated`, `mutation_not_found`, `mutation_failed`,
`mutation_mixed`) is derived server-side from the normalized receipts
(`deriveMutationMessageKey`) — never proposed by the finalizer.

### Target references and current-turn selection

`TargetReference` is the typed, deterministic resolution of a mutation's target:

```ts
export type TargetReference =
  | { kind: 'ordinal'; index: number }   // prior group ordinal ("the second one")
  | { kind: 'lead' }                     // prior lead pronoun ("it", "ese")
  | { kind: 'other'; index: number }     // "the other one" / "el otro"
  | { kind: 'named_event'; eventId: string }
  | { kind: 'named_venue'; venueId: string }
  | { kind: 'current_selection'; index: number }  // THIS turn's validated selection
  | { kind: 'none' }
  | { kind: 'ambiguous' }
```

- A standalone follow-up ("Save it", "save the second one") resolves against
  **prior displayed groups** (`lead` / `ordinal`).
- A **compound discovery + mutation** ("Find me a tango event and save it",
  "find three options and save the second one") targets the **current-turn
  validated selection** (`current_selection`, index-aligned with the selected
  events and their exact source artifacts) — never an old card. Discovery wording
  is detected only inside mutation-intent parsing, so ordinary non-mutation
  follow-ups ("show me the second one") keep prior-history semantics.
- A `current_selection` index out of range is `ambiguous` (clarify) — it never
  falls back to a prior group.

### Pinned-exclusive mode

While pinned, validation and fallback **ignore** prior `resolvedEventId` /
`resolvedVenueId`; only the pin and its known venue (from `PinResolution.venueId`,
authoritative even without a `get_event_details` artifact) authorize
directions/venue. A mutation targets the pin **only** for an explicit pin
reference (lead pronoun or an exact named reference to the pin) or a
reference-free command; an ordinal/named/venue reference to another event while
pinned is `ambiguous` — it is never silently pinned.

## Deterministic localized text materialization

`materializeText` picks the `{ en, es }` row for `messageKey` and interpolates at
most one sanitized name for the three lead keys. `materializeClarificationQuestions`
maps clarification keys to `{ en, es }` labels, sliced to two, and
`materializeClarificationText` joins those labels for the one text block. All
tables are complete — there is no path to an empty or missing localized string.

## Response language

The response language follows the **latest user message**; the UI locale is only
a fallback when the message is empty or language-neutral
(`detectResponseLanguage` in `context.ts`). Detection is deterministic and cheap:
accented/inverted-punctuation text is a strong Spanish signal, otherwise
distinctive EN vs ES content words score. A user who switches languages
mid-conversation gets the response in the switched language.

## Separate localized operation receipts

Operation text does not flow through `text`. Each `OperationReceipt` carries its
own `message` from `mutationMessage(toolName, outcome, locale)` — a complete
deterministic `{ en, es }` table over the six `MutationOutcome`s × two mutation
tool names. The mutation-result `text` is one of the six outcome-aware lead keys,
each a fixed localized template.

## Tri-state canonical event saved

`SavedState = boolean | null`. `CanonicalChatEventPayload = ChatEventPayload & {
saved: SavedState }`. `true`/`false`/`null` are all valid (the runtime guard
`isCanonicalEvent` accepts all three); the ordinary DB/search `ChatEventPayload`
keeps `saved` optional because pre-v4 rows have no marker.

## Structured direction identity

`DirectionsData = { venueName, address, mapsUrl, eventName?, eventId?, venueId? }`.
`eventId`/`venueId` are the relation identity used to validate a directions ref is
a compound sibling of the selected/pinned/resolved target — not just "the latest
directions call".

## Compound siblings

Server-created operation receipts are siblings of the primary read kind; the
finalizer's `operationToolCallIds` field does not create or authorize them.
Directions and venue are compound siblings attached only when their identity
ties to a selected event's venue, the
pinned event's venue, or an earlier resolved target (`unrelated_directions_ref` /
`unrelated_venue_ref` otherwise). The empty kinds (`clarification`,
`out_of_scope`, `error`) may carry operations but never events/directions/venue
(`inconsistent_response_kind` otherwise).

## Relatedness validation

`validate.ts` builds `allowedEventIds` (selected events + pinned + resolved) and
`allowedVenueIds` (selected events' `venue_id` + pinned venue + resolved venue).
A directions ref is related if its `eventId` ∈ allowedEventIds or its `venueId` ∈
allowedVenueIds; a venue ref is related if its `venueId` ∈ allowedVenueIds.
**While pinned, the prior resolved ids are excluded** — only the pin and its known
venue authorize relations.

## Pinned enforcement

If `pinnedEventId` is set, the selected event MUST be that event from its
`get_event_details` artifact (`kind === 'event_details'`, single selection).
Any other selection — or the same id from the wrong source — fails
`pinned_substitution`. The fallback likewise prefers only the exact pinned
`get_event_details` artifact and shows no alternate when it is missing. The pin's
known venue (`pinnedVenueId`) is authoritative for relation validation even when
the details artifact is absent.

## No-results provenance

A `no_results` response carries `emptySourceToolCallIds` (the grounding empty
sources) in provenance and no events/directions/venue. It is rejected when the
active search stage outcome is not `empty` (`success` / `partial_success` /
`partial_failure`), when any selectable search source has events, or when the only
grounding is a failed stage.

## Post-validation behavior

After a validated (or fallback) canonical is produced, suggestions are generated
only from an exact successful search artifact that actually produced a selected
event (`findSuggestionSource` / validator `suggestionSourceToolCallId`), and the
canonical's `provenance.suggestionToolCallIds` is set to that exact tool call.
There is no post-validation topic/coverage guard mutation of the response — a
validated canonical is never rewritten into a semantically different response.

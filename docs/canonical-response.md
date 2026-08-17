# Canonical Response and Finalizer Schema (v4)

The v4 canonical is **closed**: server text is deterministic and the finalizer
plan has no free-text field. Everything user-visible is derived server-side from
a closed key plus validated artifact facts.

Source of truth for the types: `src/shared/lib/types.ts`. The finalizer schema:
`src/features/chat/api/agent/finalizer.ts`. Text materialization:
`src/features/chat/api/agent/materialize.ts`.

## Strict canonical schema

```ts
export const CHAT_CONTRACT_VERSION = 4 as const

export type ResponseKind =
  | 'recommendations' | 'event_details' | 'saved_events' | 'directions'
  | 'venue_details' | 'mutation_result' | 'clarification' | 'no_results'
  | 'out_of_scope' | 'error'

export const MESSAGE_KEYS = [
  'recommendations', 'recommendations_pick', 'event_details', 'saved_events',
  'directions', 'venue_details', 'mutation_result', 'clarification',
  'no_results', 'out_of_scope', 'error',
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
- `messageKey` is the 12-value `MESSAGE_KEYS` enum. Two keys map to
  `recommendations`: `recommendations` (list) and `recommendations_pick` (single
  surprise/decisive pick). `share_guidance` maps to `out_of_scope` and produces
  fixed share-button help without tools or free prose. `MESSAGE_KEY_KIND` (in
  `materialize.ts`) is the authoritative kind↔key mapping; the validator rejects
  (`invalid_message_key`) any key whose kind does not match `kind`.
- The finalizer's `primaryKind` is the same `ResponseKind` enum; the validator
  takes `kind = plan.primaryKind` and then checks `MESSAGE_KEY_KIND[messageKey]`
  equals `kind` (mismatch fails with `invalid_message_key`).

### Exact artifact refs

- `EventSelection = { eventId: string; sourceToolCallId: string }` binds every
  selected event to the exact tool call that produced it. Validation re-resolves
  each id against that source artifact (same `requestId`, succeeded, contains the
  id); a wrong source kind or a missing/mismatched id is a typed failure
  (`invalid_source_tool_call`, `inconsistent_response_kind`,
  `unknown_event_id`).
- `directionsToolCallId` / `venueToolCallId` / `suggestionSourceToolCallId` /
  `operationToolCallIds` / `emptySourceToolCallIds` are all exact ledger tool-call
  ids, validated for kind, success, and request identity.

### Empty-source refs

`emptySourceToolCallIds` grounds a `no_results` response. A valid empty source is
either an active `search` entry with `zeroResults` or a `saved-events` entry with
`zeroResults`. `no_results` with no empty ids fails (`invalid_empty_source`), as
does any empty id that is not such a source. A failed-only stage can never ground
`no_results`.

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
  contractVersion: z.literal(4),
  primaryKind: z.enum(RESPONSE_KINDS),
  messageKey: z.enum(MESSAGE_KEYS),
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
  reason: z.enum(PLAN_REASONS).nullable(),
})
```

- `reason` is an optional closed informational marker (`empty_search` /
  `empty_saved_events`), never prose and never an eligibility authority.
- The finalizer runs with `temperature: 0` and `NO_THINKING`, producing this
  object via `Output.object({ schema: responsePlanSchema })`. It never runs tools
  and never parses free-form JSON. `NoOutputGeneratedError` /
  `NoObjectGeneratedError` become `invalid_schema`; any other throw becomes
  `finalizer_error` — both are deterministic-fallback triggers.

## Deterministic localized text materialization

`materializeText` picks the `{ en, es }` row for `messageKey` and interpolates at
most one sanitized name for the three lead keys. `materializeClarificationQuestions`
maps clarification keys to `{ en, es }` labels, sliced to two, and
`materializeClarificationText` joins those labels for the one text block. All
tables are complete — there is no path to an empty or missing localized string.

## Separate localized operation receipts

Operation text does not flow through `text`. Each `OperationReceipt` carries its
own `message` from `mutationMessage(toolName, outcome, locale)` — a complete
deterministic `{ en, es }` table over the six `MutationOutcome`s × two mutation
tool names. `text` for `mutation_result` is the fixed template ("I updated your
saved events." / "Actualicé tus guardados."); the per-event receipts are the
receipt `message`s.

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

Operations are always siblings of the primary read kind (any primary kind may
also acknowledge `operationToolCallIds`). Directions and venue are compound
siblings attached only when their identity ties to a selected event's venue, the
pinned event's venue, or an earlier resolved target (`unrelated_directions_ref` /
`unrelated_venue_ref` otherwise). The empty kinds (`clarification`,
`out_of_scope`, `error`) may carry operations but never events/directions/venue
(`inconsistent_response_kind` otherwise).

## Relatedness validation

`validate.ts` builds `allowedEventIds` (selected events + pinned + resolved) and
`allowedVenueIds` (selected events' `venue_id` + pinned venue + resolved venue).
A directions ref is related if its `eventId` ∈ allowedEventIds or its `venueId` ∈
allowedVenueIds; a venue ref is related if its `venueId` ∈ allowedVenueIds.

## Pinned enforcement

If `pinnedEventId` is set, the selected event MUST be that event from its
`get_event_details` artifact (`kind === 'event_details'`, single selection).
Any other selection — or the same id from the wrong source — fails
`pinned_substitution`. The fallback likewise prefers only the exact pinned
`get_event_details` artifact and shows no alternate when it is missing.

## No-results provenance

A `no_results` response carries `emptySourceToolCallIds` (the grounding empty
sources) in provenance and no events/directions/venue. It is rejected when any
selectable search source has events or when the only grounding is a failed stage.

## Post-validation behavior

After a validated (or fallback) canonical is produced, suggestions are generated
only from an exact successful search artifact that actually produced a selected
event (`findSuggestionSource` / validator `suggestionSourceToolCallId`), and the
canonical's `provenance.suggestionToolCallIds` is set to that exact tool call.
There is no post-validation topic/coverage guard mutation of the response — a
validated canonical is never rewritten into a semantically different response.

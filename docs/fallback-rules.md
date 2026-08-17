# Deterministic Fallback Rules (v4)

When the finalizer errors or its plan fails validation, `buildFallback`
(`src/features/chat/api/agent/fallback.ts`) derives a safe canonical response
directly from the artifact ledger. Every rule below is deterministic; the model
is never consulted on the fallback.

## Pinned

- If `pinnedEventId` is set, the fallback prefers ONLY the exact
  `get_event_details` artifact for that event. If present, the primary is
  `event_details` with that single event.
- If the pinned details artifact is missing, no alternate event is shown (the
  response has no cards and no directions/venue unless their identity ties to the
  pinned event/venue).
- A pinned event can never be substituted by a search result.

## Search stages / retention / rejection

The primary events source for a non-pinned turn is the **latest events-bearing
read** (`latestEventRead`: search / saved-events / event-details by
`(stepIndex, callIndex)`).

When that latest read is a search (`searchPrimary`):

- A rejected active stage yields `error` with zero cards and `stageIds =
  [active.stageId]` — a rejected stage has no retention power and no eligibility.
- Otherwise the active stage's entries plus explicitly retained sources
  (`retainedSearchToolCallIds`) contribute events, deduped in order, capped
  (`clampCap`, 1..5).
- If events remain: `recommendations` (or `recommendations_pick` when exactly one
  event and any source's `objective === 'surprise'`).
- If no events and the active stage outcome is `empty`: `no_results` grounded on
  the active stage's tool-call ids.
- If the active stage is failed-only: `error` — earlier successful cards are never
  resurrected.

## Compound relation

Directions and venue are compound SIBLINGS attached only when their identity ties
to a target:

- `allowedEventIds` = selected/pinned/resolved event ids.
- `allowedVenueIds` = selected events' `venue_id` + pinned venue + resolved venue.
- Directions attach when `directions.eventId` ∈ allowedEventIds or
  `directions.venueId` ∈ allowedVenueIds.
- Venue attaches when `venue.venueId` ∈ allowedVenueIds.

They are never a "last-read-wins" primary replacement and never a union of
unrelated reads. With no events source, a directions/venue artifact is a valid
primary only when tied to a pinned/resolved target.

## Operations never rerun

Mutation receipts (`ledger.mutationReceipts`) are preserved as siblings in every
fallback branch — including `error`, `no_results`, and the empty cases — and are
never retried or re-executed. `provenance.mutationToolCallIds` is always the
deduped mutation tool-call set.

## Exact provenance

The fallback sets `provenance`:

- `origin: 'fallback'`, `fallbackUsed: true`, `fallbackReason: <closed
  FallbackReason>` (the exact validation/planning violation, never free-form).
- `sourceToolCallIds` / `directionToolCallIds` / `venueToolCallIds` /
  `emptySourceToolCallIds` / `retainedSourceToolCallIds` / `stageIds` from the
  derived content.
- `searchAttemptToolCallIds` = the active stage's `toolCallIds`.
- `suggestionToolCallIds: []` (orchestrate repopulates it only when suggestions
  are generated from an exact search artifact).

## Localized non-empty text

Fallback text is materialized with `materializeText` (the same table as the
validated path), so it is localized (`en`/`es`) and never empty. Examples:
`error` → "Something went wrong. Please try again." / "Algo salió mal. Probá de
nuevo."; `no_results` → the fixed "couldn't find anything" template. The
lifecycle is marked `completed_with_fallback` with the exact reason stored in
`error_type` (guest debug) and the `chat:response_completed_with_fallback`
analytics event carries the same reason.

## Which failures route here

`orchestrate.ts` calls `buildFallback` when the finalizer returns
`{ ok: false }` (mapping `finalizer_error` vs `invalid_schema`) or when
`validatePlan` returns `ok: false` (using `validated.reason`). The full closed
`FALLBACK_REASONS` union is in `src/shared/lib/types.ts`.

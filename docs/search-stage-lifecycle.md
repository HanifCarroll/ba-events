# Search Stage Lifecycle (v4)

Search discovery is modelled as an ordered sequence of `SearchStage`s in the
artifact ledger (`src/features/chat/api/agent/ledger.ts`). This replaces the v3
"latest successful search step" heuristic with typed eligibility and outcome that
both the validator and the fallback consume structurally.

## Shape

```ts
export type SearchStageEligibility = 'active' | 'superseded' | 'rejected'
export type SearchStageOutcome = 'success' | 'empty' | 'failed'

export interface SearchStage {
  requestId: string
  stageId: string                 // `stage-${stepIndex}`
  stepIndex: number               // zero-based work-generation index
  toolCallIds: string[]           // search tool-call ids, model call order
  eligibility: SearchStageEligibility
  outcome: SearchStageOutcome
  supersededByStageId: string | null   // next later stage's stageId; null for active
  retainedSourceToolCallIds: string[]  // earlier sources retained by THIS stage (active only)
}
```

Every field is derived deterministically by `Ledger.searchStages(requestId?)`.
There is no free text and no persistence of stage shape — it is rebuilt per
request from ledger entries.

## One stage per generation's parallel search calls

- A stage is created for every work generation (step) that called `search_events`
  at least once, regardless of whether the call succeeded, returned zero events,
  or failed. `work-loop.ts` records `retention.searchStages.push({ stepIndex,
  toolCallIds })` for the step once any search call is observed.
- Parallel search calls in the same generation belong to the same stage. Their
  order within the stage is **model call order** (`callIndex`), never
  result-completion order — `searchStages` sorts entries by `callIndex`, so a
  parallel call that finished first but was emitted second stays second.

## Model call order

- `LedgerEntry.callIndex` is the zero-based index of the call within its step, in
  model call order, assigned by `work-loop.ts` as it iterates `step.toolCalls`.
- `searchStages` sorts within a step by `callIndex`; the finalizer's compact
  ledger prints entries as `step${stepIndex}.${callIndex}`, so the model sees
  source order, not completion order.

## Eligibility

Computed in `searchStages`:

- **`active`** — the last stage (highest `stepIndex`). Only one active stage.
- **`rejected`** — an earlier stage whose exact full `toolCallIds` set matches a
  successful `reject_search_results` call (set equality via `setsEqual`). Rejection
  is whole-stage only: partial/current/future id sets are rejected by the control
  tool itself.
- **`superseded`** — every other earlier stage (not rejected, not active).

A new stage supersedes earlier stages **the moment it is created** — before its
results are known. So a later failed refinement supersedes an earlier successful
search; the earlier cards are not resurrected (see below).

`searchSourceStatus(toolCallId)` adds two more transient states for validation:

- **`retained`** — an earlier source explicitly reactivated by the active stage
  (see retention below).
- **`unknown`** — not a search source in this request.

Rejected wins over active in `searchSourceStatus`: an explicitly rejected latest
stage is not selectable even though it is the last stage.

## Outcome

Computed from the stage's succeeded entries:

- **`failed`** — no succeeded search call in the step.
- **`empty`** — at least one succeeded call but `totalEvents === 0` across them.
- **`success`** — at least one succeeded call and `totalEvents > 0`.

## supersededByStageId

- For every stage except the last: the `stageId` of the immediately next later
  stage (`stage-${steps[idx + 1]}`).
- The active (last) stage has `null`.

## Active-stage retainedSourceToolCallIds

`retainedSourceToolCallIds` is only populated on the active stage (all other
stages get `[]`). It holds the earlier source ids that THIS stage's generation
explicitly retained via `retain_search_results`. Retention is **stage-scoped**
(`Ledger.retainedSearchToolCallIds`): it is in force only for the active stage —
a newer search stage invalidates earlier retention unless the newer stage
retained the source again. Rejected sources are never retained.

## Internal controls: retain_search_results / reject_search_results

Two schema-validated, no-side-effect control tools (`tools.ts`) exist only inside
the work loop; they never go through base `createTools`, never touch the
database, and have no mutation memo:

- `retain_search_results(sourceToolCallIds)` — reactivate earlier search results
  by exact tool-call ids. Only already-completed earlier sources are valid;
  current/future/non-search ids return `{ success: false, error:
  'invalid_retention' }`.
- `reject_search_results(sourceToolCallIds)` — reject ONE complete prior search
  stage by its exact `toolCallIds` set (all of that stage, no more, no fewer).
  Partial/current/future/non-search ids return `{ success: false, error:
  'invalid_rejection' }`.

Both validate against the live `RetentionControl` view (current step index +
completed earlier stage tool-call ids), never by parsing prose.

## Failed/empty latest never resurrects earlier

Two enforcement points agree:

- **Validator** (`validate.ts`): selecting a `superseded` or `rejected` source
  fails with `superseded_source` / `rejected_source`. `no_results` is rejected
  (`no_results`) when any selectable search source has events, and `invalid_empty_source`
  when the grounding source is not an active empty search or empty saved list.
- **Fallback** (`fallback.ts`, `searchPrimary`): a rejected active stage yields
  `error` with zero cards; an empty active stage yields `no_results` grounded on
  the active stage's tool-call ids; a failed-only stage yields `error`. Earlier
  successful cards are never pulled forward.

## Finalizer sees selectable facts only

`finalizer.ts` `compactLedger` prints event facts (id/name/summary/dates/venue/
neighborhood/categories/price/free) **only** for `active` and `retained` search
sources. Superseded/rejected sources print just `kind=search status=<status>` —
no names, no descriptions, no search metadata. Failed/empty active stages print
only safe ids + outcome + count.

## Fallback attempt/stage provenance

- `provenance.searchAttemptToolCallIds` = the active stage's `toolCallIds`
  (success, empty, or failed). From the validator: `ledger.activeStage(requestId)?.toolCallIds ?? []`; from the fallback the same.
- `provenance.stageIds` = the ids of every stage whose `toolCallIds` intersect
  the response's `sourceToolCallIds` + `emptySourceToolCallIds`
  (`contributingStageIds`). A response whose selected events came from an earlier
  retained source and the active stage reports both stage ids.

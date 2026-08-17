# Concierge Eval Coverage (v4)

Two complementary suites cover the concierge agent: a deterministic
no-model/no-DB regression suite and a live model+DB suite. Both are runnable
locally; the deterministic suite also runs in CI via the explicit `bun test`
step (`bun run test`/Vitest excludes `evals/` and does not run it).

## Deterministic mocked eval

`evals/concierge/deterministic.test.ts` — a test file with no model and no
database (Vitest-style imports, discovered by `bun test`). It drives the pure components through fixed, adversarial ledgers built
with `evals/concierge/_test-helpers.ts` helpers (`ledgerFrom`, `searchEntry`,
`directionsEntry`, `eventDetailsEntry`, `rejectionEntry`, …).

Components pinned (no model in the loop):

- `validatePlan` — stage eligibility (`superseded_source`, `rejected_source`),
  pinned substitution, compound relation, no-results grounding.
- `buildFallback` — latest-stage-wins, rejected-active-stage error, failed-stage
  error with no resurrection, exact `searchAttemptToolCallIds`/`stageIds`
  provenance, typed `fallbackReason`/`fallbackUsed`.
- `resolveReferences` — grouped ordinal resolution, saved-marker stamping.
- `buildPriorContext` — mutation-only group omission, chronological saved
  stamping.
- `parseDataResponseHint` — untrusted-payload stripping (names/prose dropped, ids
  survive), then DB rehydration of names.
- `mutationMessage` — deterministic Argentine-Spanish receipt table.

The scenarios mirror the live cases (romantic speed-dating regression, pinned
substitution, guest injection) but assert on the deterministic layer rather than
model output. Run with `bun test evals/concierge/deterministic.test.ts` (or the
plain `bun test` step, which discovers it). `bun run test` (Vitest) excludes
`evals/` and does not run it.

## Live model+DB concierge eval

`evals/concierge/run.ts` runs each single-turn case through the real agent
(`orchestrate` → work loop + finalizer + validation/fallback) against the real
DeepSeek model and the dev database with an anonymous user context, then scores
deterministically (tool choice, limits, filter args, voice, locale, grounding).
It mirrors `src/routes/api/chat/+server.ts` without the HTTP/stream layer.

Files:

- `evals/concierge/cases.ts` — `CONCIERGE_CASES` (decision rules, discovery,
  counts, filters, tool selection, vague asks, grounding, enumeration, scope).
- `evals/concierge/run.ts` — runner + scorer, `bun evals/concierge/run.ts`.
- `evals/lib/run-agent.ts` — `runConcierge` (orchestrate + grounding check).
- `evals/lib/checks.ts` — voice-rule and language detection.
- `evals/lib/report.ts` — per-case report, non-zero exit on failure.

Run: `bun run eval:concierge` (or `bun evals/concierge/run.ts`; an optional case
id filters to one case). `cardsGrounded` re-checks that every displayed card
traces to a successful current-request ledger artifact credited by
`provenance.sourceToolCallIds`.

## Secrets (live suite only)

The live suite needs real provider and database credentials; the deterministic
suite needs none. See `evals/concierge/README.md` for the exact env vars and the
CI `workflow_dispatch` job that supplies them as secrets.

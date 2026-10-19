# Concierge eval

Two layers verify the ToolLoopAgent concierge:

1. **Deterministic** — `deterministic.test.ts`, no model/database, discovered by
   `bun test`. It uses the injected agent runner and covers follow-ups,
   ambiguity, tool chaining, refs, grounding, pins, empty results, and shared
   web/Telegram history.
2. **Live** — `run.ts`, explicitly invoked against DeepSeek and the dev database.

```bash
bun test evals/concierge/deterministic.test.ts
bun run eval:concierge       # requires live credentials
```

The live runner calls the shared production turn preparation with the installed DeepSeek model and
scores tool reads, limits, locale, zero chat mutations, and canonical card
provenance. It must not be run accidentally.

`bun run eval:concierge:langfuse` publishes the same cases and graders as a
Langfuse experiment. See [Langfuse setup](../../docs/langfuse.md) for credentials,
context support, trace contents and reproducibility limits. Existing tests and
the local report remain available.

## Multi-turn frozen-corpus evaluation

```sh
bun run eval:concierge:multi --trials 3
bun run eval:concierge:multi --trials 3 --langfuse
bun run eval:concierge:multi --case ordinal-details-directions-en --trials 3 --langfuse
```

This suite calls the real production concierge and model, with all five external
read executors and prior-event rehydration replaced by the version-controlled
synthetic corpus in `frozen-corpus.ts`. No Supabase, embeddings, hosted reranker,
or live event data is used. The nine synthetic events are not real listings.
Search reuses production intent/date canonicalization and final diversity or
surprise ranking, with deterministic fixture venue resolution and preference
ordering. This measures planner and conversation behavior, not production
retrieval recall or semantic ranking quality.

Eleven English/Spanish conversations cover ordinal details, directions,
clarification recovery, constraint and budget refinement, the newest result
list, empty-result recovery, and missing source descriptions. Each turn receives
the actual preceding canonical responses through production hint/search-context
parsers and bounded history. Expected ordinal targets come from the actual
newest displayed list. Cases never receive golden prior cards.

Every trial begins with empty state, independent fixture reads, and a distinct
session. The default is three trials and two concurrent conversations; turns
within each conversation remain sequential. `--trials` accepts 1–10, where one
is only a smoke check; `--concurrency` accepts 1–4. A complete passing result
requires every expected turn and trial to pass. Mixed results, exceptions,
missing trials, and missing Langfuse experiment scores fail the command.

After an empty search, the fixture executor uses the same effective-constraint
retry guard as production. A retry may keep or narrow the original scope;
broader searches require a new user turn. Grading still checks every attempted
search, including rejected ones, so server protection does not conceal a model
that attempts to drop the user's filters.

Reports under ignored `results/evals/concierge/` contain per-turn outputs,
failures and timing, per-case pass rates and variability, corpus version/hash,
fixed Buenos Aires clock, case and orchestration-source hashes, configured model,
canary percentage, release label and trial settings. The model still varies
between trials; freezing data does not promise identical model output. Langfuse
records each conversation trial as an experiment item, with conversation and
per-turn scores and linked model/tool traces. Export is opt-in with `--langfuse`.

These are explicitly invoked model evaluations and incur provider costs. The
ordinary test suites remain offline. Their deterministic harness regressions
are in `src/features/chat/api/agent/concierge-multi-turn.test.ts`.

## Thinking comparison

```sh
bun run eval:concierge:thinking --trials 3
bun run eval:concierge:thinking --case simple-assessment-en --trials 1
```

The comparison alternates configured adaptive (wire enabled) and disabled
thinking for each independent conversation pair, reverses order across trials,
and runs generation sequentially to avoid contention between variants. Each
mode retains its own actual history. Production keeps its existing adaptive
setting; the comparison uses an explicit server-only runner argument. There is
no public request field or environment switch enabling the experiment.

The eleven scenarios include the existing constraint, ambiguity, ordinal and
missing-description controls plus English/Spanish "does it look fun?" follow-ups
and a Spanish missing-description conversation. Both simple requests and
harder guardrails matter when assessing a possible selective policy. No
automatic request classifier or production policy is implemented here.

The receipt retains every trial, failures, source/corpus/configuration hashes,
reported model/cache/reasoning usage, first structured artifact, first text after
an authoritative read, and completion. First text can include a template
acknowledgement; placeholder text before a read does not count. Text-only
follow-ups may have no structured artifact. Frozen reads exclude production
HTTP, workflow, database, embedding and reranking latency.

After generation, the existing evidence-based judge grades all prose with the
same rubric and without variant labels in its input. Grading time is separate;
invalid/failed grades cannot count as passes. Scores remain uncalibrated and
do not replace independent human review. `--skip-quality` is an explicitly
incomplete diagnostic run and cannot pass the full comparison gate. One trial
is a smoke check; use repeated trials for a comparison. No result changes
production settings automatically. Reports live under ignored
`results/evals/concierge/thinking-<run-id>.json`.

Fresh reports also contain eval-only model evidence for separate prose grading.
Run `bun run eval:concierge:judge-controls` and then
`bun run eval:concierge:quality --report /absolute/path/to/report.json --langfuse`.
The developer-authored controls include English/Spanish unsupported seating
claims and generic ticket boilerplate that does not establish an activity.
They diagnose judge behavior; they are not independently calibrated human labels
or additional generated conversations in the thinking comparison.
Prose scores remain provisional until independently calibrated against human
labels. See [task outcomes, rubric and human review](../../docs/concierge-quality.md).
The thinking comparison also accepts `--candidate low-effort` to compare the
unchanged default against enabled thinking with low effort, or
`--candidate direct-directions` to evaluate model-selected complete directions
without the final prose call. Both are explicit evaluation injections; production
settings are unchanged. The direct candidate defaults to two bilingual holdout
conversations that include compound directions-and-description requests followed
by a directions-only turn. Failed trials and judge errors remain in the receipt;
automatic prose grades remain uncalibrated. `--case` can select an existing
conversation for either candidate. Historical disabled-thinking receipts remain
unchanged.

## Malicious-source conversations

`bun run eval:concierge:injection --trials 3 --langfuse` runs eight bilingual
attack conversations, each with search, ordinal details and directions. The
production model/preparation/tool loop sees fixture-only malicious descriptions,
credential-collection instructions, poisoned event titles or forged prior-role
messages. Each trial records that the exact payload reached actual model input;
an unexposed attack cannot pass. All read executors and prior-event rehydration
use the same isolated attack corpus and fixed clock.

The contract graders check the legitimate request's filters, actual displayed
ordinal, card provenance, read-only execution, locale and canonical directions.
Separate checks fail attacker-marker contamination and credential-collection
URLs in visible prose. A failure may concern task quality or boundary behavior;
inspect its category before calling it a security vulnerability. These probes
are targeted regression evidence, not an exhaustive prompt-injection guarantee.
The original conversation corpus and its fingerprint remain unchanged.

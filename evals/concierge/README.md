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

Eight English/Spanish conversations cover ordinal details, directions,
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

Fresh reports also contain eval-only model evidence for separate prose grading.
Run `bun run eval:concierge:judge-controls` and then
`bun run eval:concierge:quality --report /absolute/path/to/report.json --langfuse`.
Prose scores remain provisional until independently calibrated against human
labels. See [task outcomes, rubric and human review](../../docs/concierge-quality.md).
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

# Concierge eval coverage

The deterministic suite runs without a model or database; the live suite runs
against the real ToolLoopAgent only when explicitly invoked.

`evals/concierge/deterministic.test.ts` covers CHEBA description continuity,
pronouns and ordinals, genuine ambiguity, multi-step search plus details or
directions, exact ref-to-ID validation, prose/card grounding, pin behavior,
and shared web/Telegram history. `agent/history.test.ts` covers history bounds
and current-turn de-duplication. Follow-up tests retain adversarial rehydration
and authoritative saved-membership coverage.

The live cases in `evals/concierge/cases.ts` exercise search-field selection,
limits, scope refusals, locale, grounding, compound tool calls, and zero chat
mutations. Web and Telegram both use `runSharedChatTurn`; channel rendering is
outside the agent.

```bash
bun test evals/concierge/deterministic.test.ts
bun run eval:concierge       # requires explicit live credentials
```

Live evaluation needs the existing DeepSeek, Supabase, embedding, and optional
Voyage environment variables. Never run it accidentally or commit secrets.

The multi-turn suite uses a frozen event corpus and Buenos Aires clock with
production preparation/orchestration and controlled reads. It needs a model key
but makes no database or retrieval-provider calls. Use a bounded case comparison
for prompt work; the release checkpoint can run the full suite.

The October retrieval refresh uses the existing candidate capture and blinded
review tools with `evals/search/relevance/holdout-2026-10.ts`: six bilingual pairs,
ten holdout queries and two explicitly marked known tango diagnostics. It
preserves historical captures/labels. New captures retain exact canonical
filters, the query-file fingerprint and an explicit completion flag, and stop
if one event ID produces inconsistent frozen fields across queries.

The first refresh at `2026-10-14T03:01:31.940Z` completed all twelve queries and
froze 251 distinct retrieved event records. Its existing-tool review packet has
81 ungraded options under ignored `results/evals/retrieval-refresh-2026-10/`.
Voyage was disabled for this retrieval-only capture; it supplies no fresh hosted
ranking comparison or independently labeled recall/usefulness rate. The corpus
is the retrieved pool, not exhaustive inventory. The known tango queries also
expose questionable stored tags: a beginner salsa event carries a tango genre
tag, while other head candidates are performances/tours rather than a verified
beginner tango class. Preserve these diagnostics for source-grounded grading;
do not infer a missing-inventory result or tune the prompt to a perfect score.

```bash
VOYAGE_API_KEY= bun evals/search/relevance/capture.ts --queries evals/search/relevance/holdout-2026-10.ts --out results/evals/retrieval-refresh-2026-10/capture.json
```

The private `measurements.json` separates 396 candidate observations, 251
distinct retrieved records and zero empty candidate lists across twelve queries
from unmeasured recall/ranking quality. English/Spanish mean candidate counts
are 31/35; six queries reach the fifty-candidate cap. Later read-only counts
under the exact frozen hard filters give 1,454 unconstrained upcoming matches,
four free Recoleta matches, 219 weekend matches, seven pre-correction Almagro
matches and 136 weekend/budget/age matches. These are time-separated hard-filter
inventory counts, not relevance labels or exhaustive semantic recall.

The initial jazz captures also exposed an unrequested electronic-genre exclusion
for live music. That exclusion is removed locally; explicit exclusions remain.
`jazz-correction.json` uses the original ISO clock through `--now-ba` and captures
only the two affected cases. They return six/seven candidates rather than
five/six; common frozen records are unchanged and the added record is electronic
tagged. This proves the filter boundary changed, not that recommendation quality
improved. The original twelve-query capture and review packet remain pre-fix
artifacts. Independent source-grounded grades and a new hosted ranking comparison
are still pending; do not score missing labels as zero.

Paid-only retrieval has a separate serialized-request regression in
`src/shared/lib/db/search-filters.test.ts`. The current SQL functions also needed
a correction: their previous true-only predicates rejected explicit false.
`20261014144355_fix_paid_only_search_filters.sql` preserves both current function
signatures/result shapes and changes only those predicates. An isolated
PostgreSQL/pgvector check executes the unchanged migration, reproduces the old
failure and passes paid/free/unrestricted subsets for both functions plus
reapplication; its private receipt is `results/evals/paid-filter-sql/receipt.json`.
Apply the SQL migration before releasing clients that now retain false. These
checks do not establish deployed behavior or independently graded relevance.

```bash
bun run eval:concierge:multi --case ordinal-details-directions-en --trials 2
bun run eval:concierge:multi --case newest-list-es --trials 2 --history-stress
```

New repeated conversation reports use the existing streaming/progress path and
record `performanceVersion=conversation-performance-v1` and
`modelTransport=stream`. Each completed turn retains first useful artifact/clarification
latency and model completion latency separately from the existing duration, which
also includes grading. Placeholder prose and typing do not count as useful output.
The report retains per-step selected model/provider identity, returned model identity when available, and SDK input, cache-read,
output and reasoning counters. Raw DeepSeek usage takes precedence when available
so absent raw fields do not inherit the SDK's zero defaults. Missing/invalid
counters remain null and real zero remains zero. Reasoning is part of output,
not an additional billable token count.

These counters cover model steps returned by the SDK, not necessarily charged
failed requests or retries, embeddings or reranking. An incomplete/failing run is
not a zero-cost run. Older generation-only reports have no equivalent progress
measurement; compare transport, code/corpus hashes and performance version before
comparing latency. No old report is rewritten or remeasured by this change.

`--history-stress` seeds 24,000 characters of unrelated old dialogue while
preserving actual prior outputs and server context. Reports record the seed
version/hash and production history limit. Without the flag, the ordinary
conversation inputs remain unchanged. `--langfuse` exports the experiment;
`LANGFUSE_TRACING_ENABLED=false` also disables runtime tracing for a local-only
comparison. These contract scores do not establish human-calibrated prose quality.

BA source enrichment has twelve English/Spanish developer-labeled controls for
translation, summaries, facets, venue-name extraction and missing information.
They call the production helpers on fixed page text and prohibit source/database
fetches. Protocol failures and logged helper errors cannot pass as empty results.

```bash
bun run eval:enrichment --live
bun run eval:enrichment --live --task facets
```

Receipts under ignored `results/evals/enrichment/` retain corpus/model/source
identity, outputs, raw provider responses and per-case failures. The labels check
selected terms, numeric representation, paragraph structure, language, closed
facets and explicit missing states. They do not prove complete semantic fidelity
or replace independent human review. The initial v1 and revised v2 reports remain
separate: v2 clarifies two source controls and is not an untouched holdout. The
latest facet follow-up passes two of three controls; tango activity recall remains
open. Venue controls cover name extraction, not geocoding or identity settlement.

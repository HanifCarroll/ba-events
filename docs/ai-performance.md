# AI performance and spending

Use the existing Langfuse projects, eval receipts and scan ledger. These are
provisional operating targets for the current small deployment; they are not
measured production service levels or a promise to the traveler.

| Measure | BA Eventos | Casamo |
| --- | --- | --- |
| First useful result, p95 | Within 5 seconds of starting a turn | First acquired candidate/progress within 60 seconds of scan admission |
| Complete response, p95 | Within 15 seconds | Saved qualified-choice report within 15 minutes of admission |
| Existing hard execution boundary | 60 seconds per turn; 20 seconds per model step | 60 minutes per admitted scan; queue wait is separate |
| Cost per independently reviewed success | Unmeasured; target awaits independent outcome labels | Unmeasured; target awaits independent outcome labels |

Count first useful BA output as a grounded event preview or a complete
clarification or authoritative directions/venue artifact, not typing or generic progress. For Casamo, count acquired provider
evidence or a persisted meaningful stage update, not queue admission. Measure queue
wait separately. Include failures in latency reporting rather than dropping slow
requests. Report sample counts and observation dates with every percentile.

## Current evidence

The saved BA frozen-corpus run `1287e549-6745-43fe-8815-b9c090184f98`
contains eight conversations, three independent trials and 72 turns at concurrency
two. Complete-turn latency was p50 **5,116 ms**, p95 **9,005 ms** and maximum
**13,044 ms**, using nearest-rank percentiles over all turns. These are historical
API timings with controlled event reads, before the new output cap; they exclude
real catalog retrieval and do not establish production performance. Those
receipts used generation-only transport; future performance receipts explicitly
identify the streaming path. First useful
output and complete model usage were not recorded in that receipt.

The original automatic contract result remains 23/24; the separately documented
language-detector correction does not replace the original report. Independent
prose labels are pending, so cost per reviewed success remains unknown. Casamo's
review/photo experiments do not measure end-to-end scan completion. Do not use
their timings as whole-scan latency or their label agreement as customer success.

The existing conversation adapter now captures first useful grounded output and
completion timing through the production progress callback and retains model-step
usage. It does not launch new model runs. Missing usage stays null; raw DeepSeek
usage avoids the SDK's zero defaults for omitted fields. Usage on returned steps
is not proof of total provider spending when failed requests or retries may have
been charged. Future comparison receipts identify this measurement version and
streaming transport; historical reports remain unchanged.

## Existing controls and the small remaining gaps

BA limits orchestration to five steps, eight tool calls, one SDK retry, seven
seconds per read, bounded dialogue and 16,000 observed input tokens per request.
The model request now also declares **8,192 output tokens per call**, with that
setting included in its configuration fingerprint. The input guard runs after a
provider reports usage, so the first oversized request may already be charged.
Successful reads remain available under the existing fallback rules.

Casamo's shared structured client defaults to 4,096 output tokens. Its released
audit input guard rejects more than 64 KiB of complete text before
I/O and rejects reported input beyond 32,768 tokens after the response. That
context-budget change was released in [Casamo PR #7](https://github.com/HanifCarroll/casamo/pull/7)
with owner approval for the operational safeguards. Its production smoke retained
bounded provider failures, two visible stays and cleared permits; it did not
establish fresh model-quality acceptance. The accepted scan
manifest owns action attempts, deadlines and durable resource permits. Keep those
existing controls; changes to their numerical ceilings must use a new captured
policy revision. Permits count actions and can cover multiple photo calls, so
they must not be reported as an exact number of simultaneous HTTP requests.

Per-call output limits and concurrency permits are not a monthly dollar cap.
The owner selected **US$20 per month**, provisionally shared across BA Eventos
and Casamo. This is a planning target, not an enforced cutoff. Use native provider
balance/billing controls and existing usage views for this scale.
Failures and retries belong in total spending; cost per success divides that
total by independently reviewed successful outcomes and stays unknown when that
denominator is unavailable.

## Price assumptions and the next comparison

The [DeepSeek pricing page](https://api-docs.deepseek.com/quick_start/pricing/),
checked October 14, 2026, lists Flash per-million-token rates of $0.003–$0.006
for cached input, $0.15–$0.30 for uncached input and $0.60–$1.20 for output.
Legacy Flash aliases currently use the Flash model/rates. Actual billing depends
on cache usage, request time and applicable pricing; these figures exclude
embeddings, reranking, browser acquisition and infrastructure.

Use reported cache/input/output counters for an estimate and retain the rate
date. Missing counters remain unknown; do not silently price them as zero or
report an estimate as an invoice. Both trace exporters now map reported DeepSeek
Flash counters to published peak/off-peak token-rate estimates, with explicit
totals, estimate/rate/time-basis metadata and unknown values preserved. The
deployed visibility receipts and fallback denominators are recorded under
section 8 of the shared worklist. This excludes other providers and infrastructure.

For the next model/configuration comparison, reuse the frozen conversation
corpus and existing repeated-trial adapter. Record selected and returned model,
prompt/configuration/corpus hashes, trial count, latency, usage, failures and
reviewed quality together. Change one setting at a time. The installed SDK maps
configured `adaptive` thinking to wire `enabled`; record the wire mode rather
than comparing it as a distinct provider capability. Do not select a cheaper
configuration based on latency alone or run a larger benchmark before the
pending quality labels can support the decision.

## Recorded provider billing checkpoint — October 15, 2026

The owner-approved DeepSeek USD low-balance email is enabled at US$5 and was
verified by reopening its saved settings. This is a balance notification, not
a monthly spending cap. The saved October view showed US$1.90 for the selected
BA Eventos/Casamo keys; other apps share the account. Signed-in Voyage BA Eventos
showed US$0.00 October spend and exposed budget email alerts, with none configured
and no hard cutoff shown. These are dated, partial observations rather than a
current complete provider bill. No purchase or recharge was made.

The shared US$20 target has no per-provider allocation or enforced combined cap.
Use the dated evidence in `results/releases/spending-controls/current.json` and
the [shared worklist](applied-ai-engineering-work.md) for the recorded decisions.

## Production chat profile on October 18 2026

The largest measured opportunities are before model execution and in the two
serial model calls. Event detail reads are fast. Semantic search adds variable
retrieval and reranking time. Removing a duplicate card fixes presentation;
it does not remove either model call or prove a latency improvement.

Measurements used the deployed `https://baeventos.com` guest flow from Buenos
Aires: three independent three-turn API conversations, a fresh Chromium browser
conversation, and a three-turn semantic-search conversation. All fifteen
measured turns returned a final canonical response without a fallback. The
browser added the actual homepage references, navigation and IndexedDB writes;
the API conversations carried actual previous canonical responses. Direct
database and telemetry inspection was read-only. No dev server was started.
The additional preliminary browser probe was interrupted during instrumentation
and is excluded from the measured cohort.

These are sequential, low-load observations, not a load test, p95 estimate or
proof of cold-start causation. First chronological request and first message of
each new conversation are different concepts. The production UI still contained
the duplicate-card behavior during this baseline; the fix was verified locally.
Signed-in bootstrap, membership, persisted history and authoritative message
completion were inspected in code but were not timed with a signed-in browser.

### API results

Times are seconds from submitting the HTTP request. First useful means receipt
of a grounded artifact, not typing/status. For the event assessment rows, that
artifact is the old duplicate card; first prose is the more useful measurement
for the corrected text-only behavior. Discovery's first prose can be the
server's template acknowledgement, not the model's finished explanation.

| Conversation | Message | Response headers | First artifact | First prose | Final response |
| --- | --- | ---: | ---: | ---: | ---: |
| A | First discovery | 1.263 | 10.043 | 10.043 | 14.706 |
| A | Event assessment | 0.651 | 4.415 | 5.547 | 7.035 |
| A | Directions | 1.043 | 5.616 | 6.605 | 8.089 |
| B | First discovery | 0.953 | 4.396 | 4.396 | 6.461 |
| B | Event assessment | 1.022 | 6.785 | 7.705 | 8.698 |
| B | Directions | 0.887 | 5.035 | 5.971 | 6.892 |
| C | First discovery | 0.987 | 4.107 | 4.107 | 6.426 |
| C | Event assessment | 0.984 | 5.512 | 6.880 | 8.715 |
| C | Directions | 1.068 | 6.228 | 7.038 | 8.269 |

First-discovery median completion was 6.461 seconds, with a 14.706-second
maximum. Event-assessment median was 8.698 seconds; directions median was
8.089 seconds. Differences between these groups include task complexity and
model variability, so they do not isolate a message-order effect.

The browser reached its visible input in 0.586 seconds after navigation.
Its first discovery preview arrived at 6.746 seconds and final response at
8.706 seconds. Event assessment preview/prose/final arrived at
5.648/7.173/8.767 seconds; directions artifact/prose/final arrived at
6.685/7.788/9.668 seconds. The next-message control was observed ready within
40 ms of final output. This last interval includes polling granularity;
network preview receipt is not a frame-level paint measurement. Desktop
Chromium at 1440 by 1000 rendered the messages, cards and directions with no
page errors or framework overlay. Browser plugin was unavailable; Playwright
was used. The screenshot records the deployed baseline, not the local fix.

Three jazz searches in one conversation returned first cards at
7.807/7.804/4.946 seconds and final responses at 10.098/10.691/7.058 seconds.
All used the semantic path. Search reads took 3.393/1.605/0.748 seconds;
the first two recorded applied reranker calls of 0.872/0.326 seconds. The
third reranker breakdown is unobserved. Embedding, SQL, venue work and coverage
reads are included in the search total, not individually timed here. The last
two requests used the same wording, yet completion differed by 3.633 seconds:
later turns are not uniformly faster or slower.

### Where the time goes

Cloudflare logs and Langfuse spans were correlated with the request IDs from
the actual streams. Model/tool spans are siblings in the serial path; enclosing
agent/step spans are not added again. Across the nine API turns:

| Stage | Observed time | Interpretation |
| --- | ---: | --- |
| HTTP response headers | 0.651–1.263 s | Stream connection only; no answer yet |
| Submission to first thinking status | 2.196–7.450 s | Entry, durable delivery/workflow admission, execution setup and rate admission; combined, not separately instrumented |
| Submission to model start | approximately 2.393–7.857 s | Correlated status and server clocks; includes the preceding setup plus context/initialization |
| Prior event rehydration | 0.111–0.127 s in five observed follow-up logs; one missing | Guest saved-membership work was zero; browser homepage fallback read was 0.098 s in the preliminary probe |
| First model call | 1.127–2.554 s | Selects tool/reference and produces arguments; includes hidden reasoning |
| Filter-only search | 0.597–0.865 s | No semantic query; reranker reports empty query |
| Event detail read | 0.124–0.139 s | Grounding for assessment prose |
| Directions read | 0.129–0.149 s | Trusted venue/address and maps link |
| Second model call | 1.336–3.726 s | Generates final prose/framing/reasons after the read |
| Last model end to final response | approximately 0.406–1.239 s | Trace flush, checkpoint, commit-stage setup and durable publication combined |

Each turn used two model calls and one read. Provider time to the first chunk
was 0.833–1.147 seconds per call; that chunk can be hidden reasoning or tool
arguments and is not the user's time to an answer. The request body grew from
454 bytes for discovery to roughly 10.6–10.8 KB for assessment and 18.1–18.8 KB
for directions. The bounded model prompt grew from about 6.5 KB to 7.9 KB;
wire history and model context are different sizes.

The first discovery's 14.706 seconds consisted of approximately 7.857 seconds
before the model, 1.336 seconds for model routing, 0.865 seconds for search,
3.726 seconds for final generation and 0.922 seconds afterward. Subsequent
new conversations finished first discovery in about 6.4 seconds. This supports
investigating startup/admission variability; it does not identify a specific
cold cache, location or Workflow component as the proven cause.

`CHAT_THINKING` is configured as `adaptive`, but the installed DeepSeek adapter
maps that value to wire `enabled`. First model calls for the three assessments
reported 118/345/213 reasoning tokens, versus 41/23/19 for discovery. One final
discovery call used 353 reasoning tokens and took 3.726 seconds. Do not assume
that a simple follow-up automatically skips thinking. DeepSeek documents the
[enabled/disabled controls](https://api-docs.deepseek.com/guides/thinking_mode/).

The original screenshot conversation was also inspected through its stored
transcript, lifecycle rows and model/tool spans. Its first details question took
approximately 11.539 seconds from the client timestamp to the server terminal
record; the assessment took 11.614 seconds. Respectively, the components were
4.997/4.303 seconds before the lifecycle start, 0.518/0.619 seconds until model
start, 1.689/3.654 seconds routing, 0.185/0.202 seconds reading details,
1.832/2.448 seconds final generation, and 2.318/0.388 seconds afterward. Client
and server timestamp differences are approximate and do not reveal first paint.

### Recommended experiments in order

Potential savings below describe measured opportunities or estimates, not
verified improvements, and should not be added together.

| Priority | Change | Opportunity | Tradeoff and acceptance check |
| --- | --- | --- | --- |
| 1 | Add timestamps for entry, durable admission, Workflow start, rate admission, context ready and checkpoint/commit | Attribute the 2.4–7.9 s before model execution | Small instrumentation change; correlate one request without recording capabilities or credentials |
| 2 | Test thinking disabled for straightforward reads and final prose, retaining reasoning for ambiguous planning | Remove avoidable reasoning within the 2.8–5.1 s spent in the two model calls; roughly 0.5–2 s is a hypothesis | Compare one setting at a time on the frozen bilingual/ordinal/date/grounding suite and human quality examples; retain timeouts and fallback controls |
| 3 | Start an owned producer promptly after durable admission, with Workflow recovery rather than waiting for Workflow to initiate every normal request | Target the variable pre-model delay; 1–3 s is a working hypothesis | Larger delivery change; prove fencing, Stop, replay, refresh, recovery and exactly one authoritative completion/provider owner |
| 4 | Handle unambiguous event references and directions with a narrow direct-read path; prefetch authoritative detail facts before one prose call where appropriate | Avoid one model call (observed routing 1.1–2.6 s), or both calls for deterministic directions (about 3.3–3.8 s combined in these runs) | Preserve ambiguity checks and server-owned references; do not infer a target from a guessed pronoun or lose source grounding |
| 5 | Move bounded trace export off the response-critical wait using retained Worker tasks | Recover part of the 0.4–1.2 s tail; historical tail reached 2.3 s | Tail also includes checkpoint/commit; measure export separately, preserve cancellation cleanup and trace delivery |
| 6 | Improve semantic retrieval: time embedding/SQL/hydration/coverage separately, reuse exact-query embeddings across isolates when beneficial, parallelize independent coverage reads | Search varied from 0.748 to 3.393 s; avoid repeated paid retrieval work | Existing embedding cache is isolate-local. Preserve catalog freshness, membership/privacy and ranking quality. Applied reranker cost only 0.326–0.872 s here, so blanket removal is not the first recommendation |
| 7 | Reduce final prose, remove repeated history payload fields, inspect bundle initialization and batch preview persistence where measurements justify it | Smaller secondary improvements; savings not isolated | Preserve complete source evidence, per-event reasons, replay ordering and persistence-before-publication |

Start with stage attribution and the thinking comparison. Then choose between
delivery startup work and a narrow one-call/direct-directions path using the
measured remaining bottleneck. Changing model vendor is deferred until these
application costs are isolated and the same quality suite can compare options.
Cloudflare's [data-location guidance](https://developers.cloudflare.com/durable-objects/reference/data-location/)
explains potential forwarding latency; actual object placement was not measured.

Private receipts and rerunnable probe scripts are in
`results/releases/chat-latency-20261018/`. The local card fix omits previously
displayed event-detail/assessment cards from progressive and final canonical
responses while keeping successful-read evidence and the earlier ordinal list.
Fresh searches, first-time/home details, saved lists and save/unsave control
guidance retain cards. No latency option above was applied or released by this
profiling task.

Local verification passed 883 Vitest tests, 898 Bun tests, Svelte check,
TypeScript and all ten canonical specs. One real-model frozen-corpus
search → ordinal details → directions conversation passed in each language
(six regression turns total): details produced no repeated card and the next
directions turn resolved the intended event. These local regression runs are
separate from the fifteen production timing observations and are not an
independent prose-quality calibration or a model-configuration comparison.

## Startup timing instrumentation

`chat-timing-v1` emits server-only `[chat] timing` log records using the same
validated attempt/request UUID across the application Worker, delivery Durable
Object and Workflow. It does not add timing payloads to public responses.
Records contain version, requestId, phase, scope, stage, elapsedMs, durationMs
and optional sinceAdmissionMs; no headers, tokens, URLs, chat content, IP or
account identifiers are included. A failed log sink does not change execution.

The checkpoints distinguish request entry and session loading, body parsing,
delivery forwarding, encrypted durable-input storage, Workflow creation and
dispatch, signed execution verification, rate admission, claim/pin/history
loading, guest lifecycle logging, shared context preparation, lazy provider
initialization, model start, bounded trace flush, checkpoint storage, commit
gate, authoritative persistence and durable final publication. First preview
publication is marked once, not on every token.

Use requestId plus Cloudflare service, phase and scope to correlate records.
`durationMs` and `elapsedMs` share one local monotonic scope; do not add enclosing
or overlapping scopes. Scope distinguishes request, delivery_start, admission,
dispatch, producer and workflow clocks. `sinceAdmissionMs` uses the Durable
Object's persisted admission timestamp, so dispatch and publication retain an
end-to-end reference across restarts. Negative/skewed wall-clock differences
remain null. Repeated stage records can reflect legitimate fenced recovery;
use the existing execution-fence/request metadata to distinguish attempts at a
stage. The earliest application marker occurs after module evaluation, so
platform scheduling/module startup still needs the Worker invocation timings.

At the initial checkpoint this instrumentation was implemented locally. A
production timing receipt was still needed to attribute the prior
2.4–7.9-second pre-model window and 0.4–1.2-second completion tail. No queue,
retry, Stop, replay, persistence or model setting is changed by instrumentation.

## Thinking comparison — 2026-10-18

An explicit evaluation-only runner option compares the unchanged production
default (`adaptive`, mapped by the installed SDK to wire `enabled`) with wire
`disabled`. No public request option, automatic simple-turn classifier or
production setting change was added. A real-SDK transport test verifies both
wire settings, the unchanged 8,192-token cap and distinct configuration IDs.

The experiment ran 11 frozen bilingual conversations, three trials and three
turns each: 99 turns per setting, 198 real-model generation turns in total.
Whole conversations alternate settings and reverse order across trials; each
setting retains its own actual prior answers and references. The same synthetic
corpus, clock, prompt, tools, limits and `deepseek-flash` model are used. New
English/Spanish assessment cases cover “does it look fun?” followed by directions;
Spanish missing-description coverage joins the existing English case. Existing
ordinal, filter refinement, budget, newest-list, clarification, empty-search and
missing-description guardrails remain in the comparison.

These are shared-agent stream timings with frozen reads, including the normal
bounded trace-flush callback. They exclude HTTP, Durable Object/Workflow startup,
real database/search/reranking and browser rendering. First conversation turns
are new histories, not independently cold Worker starts. Percentiles below use
nearest rank and retain failed turns; they are sample observations, not
production service-level estimates.

| Metric | Current thinking | Thinking disabled | Sample per setting |
| --- | ---: | ---: | ---: |
| Completion median | 3.951 s | 3.143 s | 99 |
| Completion p95 | 6.143 s | 4.990 s | 99 |
| Completion maximum | 9.277 s | 5.909 s | 99 |
| First conversation turn, completion median | 3.505 s | 3.123 s | 33 |
| Second turn, completion median | 4.016 s | 3.307 s | 33 |
| Third turn, completion median | 4.173 s | 3.004 s | 33 |
| Simple assessment completion median | 4.447 s | 2.941 s | 6 |
| Deterministic behavior checks passed | 97/99 | 94/99 | 99 |
| Fallback responses | 1 | 0 | 99 |

Disabling thinking reduced the overall median by 0.808 seconds (20.4%) and
simple-assessment median by 1.506 seconds (33.9%). It was faster in 85 of 99
matched case/trial/turn pairs, with a median paired difference of 0.694 seconds.
The primary comparison includes failures. As a secondary sensitivity check,
92 pairs passed behavior checks in both settings; disabled was faster in 78,
with median paired saving of 0.652 seconds. This small, time-bounded experiment
does not establish statistical noninferiority or future provider performance.

Structured-artifact first arrival was 1.543/1.297 seconds median, measured in
63/60 turns respectively; text-only follow-ups often have no new artifact.
First text backed by a successful source read or structured clarification was
2.784/2.011 seconds median, measured in 99/94 turns. Five disabled turns lacked
that marker and remain unknown, not zero. This marker can include server
acknowledgement text and fallback prose; it does not independently prove that
the streamed text answers the question. Completion and quality checks remain
separate.

The disabled setting missed the required clarification tool on all three
ambiguous first-turn trials. Its prose did ask the user for clarification, so
this is a structured-contract failure, not invented directions. It also skipped
the required event-details read in one English fun assessment, and tried to
declare a source mismatch without a fresh inspection in one English
missing-description follow-up; the server rejected the latter. The current
setting also failed: one details turn attempted an invalid reference before
recovering to the correct event, and one Spanish mismatch turn exhausted the
planner path and used a grounded fallback. The invalid-reference failure does
not mean the final answer described the wrong event. Neither setting passes
the full behavior gate.

Reported model usage was 211/203 steps, 757,555/707,546 input tokens,
566,910/521,984 cached-input tokens and 34,312/17,767 output tokens for
current/disabled. Current thinking reported 15,393 reasoning tokens. The
provider omitted reasoning usage for all 203 disabled steps, so that count is
unknown despite the verified disabled wire setting. These are unequal executed
paths, not a controlled per-token cost experiment; no billed-dollar saving is
claimed.

### Answer quality and recommendation

The existing evidence-based judge evaluated all 198 generated answers after
timing finished, with the same model/rubric and no thinking-mode label in its
input. Its existing bounded retry only repairs structurally invalid grades;
valid low grades are retained. Five grades per setting failed the evidence or
judge protocol/request path and stay unknown. They are not answer failures or
passes, and their original receipt retains only a generic error classification.
The final harness now also preserves rejected-grade diagnostics for future runs.

| Diagnostic quality measure | Current thinking | Thinking disabled |
| --- | ---: | ---: |
| Valid automatic grades | 94/99 | 94/99 |
| Prose-only threshold passes | 62/94 graded | 58/94 graded |
| Combined behavior + automatic prose passes | 60/99 attempted | 54/99 attempted |
| All extracted factual claims accepted by judge | 68/94 graded | 65/94 graded |
| Recommendation suitability mean (0–2) | 1.892 (37 applicable) | 1.865 (37 applicable) |
| Recommendation-reason accuracy passes | 9/29 applicable | 11/28 applicable |
| Usefulness mean (0–2) | 1.947 (94 graded) | 1.926 (94 graded) |

These are uncalibrated diagnostics, not human-rated factual-accuracy rates.
The judge penalized subjective atmosphere language and sometimes misread “no
more description than that” as a claim that no description exists. Conversely,
it accepted the disabled answer that skipped a details read and incorrectly
claimed no description was on file. It also accepted an inferred absence of
seating in a current-thinking assessment. Eighteen developer-authored judge
controls passed, including bilingual invented seating and generic ticket
boilerplate, but that does not establish consistent real-answer grading.

A separate source spot-check of 12 first-trial assessment/missing-description
answers found that both settings acknowledged truly absent descriptions.
It flagged unverified seating implications in both English assessments:
“not a sit-down concert” for the current setting and a jazz alternative described
as a closer fit to a seated concert with thinking disabled. This is Codex
source review, not independent human calibration. The new generic-boilerplate
cases test the judge; they are not additional generated conversation cases.

**Keep production thinking enabled.** Disabled thinking is faster in this
sample, but the tool-grounding regression is enough to withhold the switch,
and neither setting clears the combined gate. There is no claim of quality
equivalence from a small speed difference or a passing control suite.

Next, release startup instrumentation separately and collect correlated first
and subsequent message timings to locate the remaining setup/tail cost. For
another model-setting experiment, retain thinking for tool selection and test
disabled thinking only for final prose after a verified authoritative read;
this narrower setting was not tested here. A direct directions path for a
validated, unambiguous reference remains another option to remove model calls.
Both require the same behavior checks and reviewed answer examples before a
production change. No model setting or delivery scheduling was changed here.

Reproduce with `bun run eval:concierge:thinking --trials 3`. The private original
receipt is `results/evals/concierge/thinking-94725b6f-5193-463c-af37-d9d087c20ab2.json`;
raw results, source snapshots matching its recorded hashes, analysis, source
spot-review, judge controls and validation logs are retained in
`results/releases/startup-thinking-20261018/`. The saved benchmark runner predates
the added timing markers; those markers do not change its model instructions or
settings. Local validation passes 894 Vitest tests, 909 Bun tests, Svelte/Effect
and TypeScript checks, production build and all ten canonical specs. The real
comparison correctly exits unsuccessfully because its quality gate fails;
successful code tests do not override that result. Instrumentation was local at
that checkpoint; the subsequent release and production attribution follow.

## Production startup attribution and research on October 18 2026

**Initial recommendation, superseded by the broader chatbot architecture review below:** remove unnecessary model calls for narrowly defined, grounded
reads first; then start generation promptly after Workflow admission is
acknowledged, retaining durable recovery. Keep production thinking enabled.** Broad discovery
also needs a small query-routing correction: city-only wording currently causes
avoidable semantic retrieval in some turns. Moving trace export off the response
path is a useful smaller improvement. Lower reasoning effort is an experiment,
not an accepted production setting.

### Release and measurement scope

[PR #24](https://github.com/HanifCarroll/ba-events/pull/24) released only timing
instrumentation. Tested commit `72f481b184bd9373325f5b4cd587530ecc1d8399` and
merge `44aeb13e8e8694899cb56febb17339797a6adad2` have identical trees. Native
Cloudflare Build `a26c2667-52a5-47a2-9cb4-e4e71d6bc1b8` succeeded at
17:21:50 UTC. All four Workers are verified active at 100%; the profiled public
Worker is `1ad6be27-a24c-47ff-a2f9-296183be257a` and delivery Worker is
`cb4b615c-b5e9-4383-a121-22f0640f6908`. Previous versions are retained privately
for rollback. There were no schema, model, prompt, thinking, retrieval or delivery
scheduling changes. The repeated-card fix and eval-only runner changes remain
separate local work.

The configured clean-checkout gate passed 919 Vitest tests, 933 Bun tests with
one runner-specific skip, Svelte/Effect checks (zero errors/warnings; 86
informational diagnostics), TypeScript and production build. All ten canonical
specs validate. Browser/workerd Stop, replay, navigation and generation/commit
recovery checks pass. Initial isolated-worktree build/fixture attempts lacked
environment configuration; their failures and successful configured runs remain
in the receipt. The release decision is `no_ai_behavior_change`.

From Buenos Aires, 17:22–17:26 UTC, the experiment submitted five independent
three-turn guest conversations (three English, two Spanish), three sequential
jazz searches and one three-turn desktop Chromium conversation. All 21 turns
completed without fallback or request errors. All have model/tool observations:
147 observations contain 42 model calls and 21 reads. Correlated Worker logs
identify the deployed code separately from tracing labels.

These are sequential diagnostic samples, not a load test, a controlled cold-start
experiment, independent quality labels or a before/after optimization result.
Task type changes with turn order, so later messages cannot be compared as if
they were the same workload. Signed-in session/profile/history reads, other
locations, mobile/Safari and concurrent load remain unmeasured. Synthetic
conversation/attempt identifiers are retained to distinguish engineering traffic
from customer outcomes; no feedback votes were submitted.

### First messages and follow-ups

Seconds from submitting the API request; each row summarizes five turns.
First artifact means a validated preview. Assessment artifacts are still the
old repeated card, so first prose is the more relevant user-facing measure.
Discovery prose can start with a server acknowledgement. Neither measure is a
frame-level paint time or proof that the entire answer is already readable.

| Turn | First artifact median | First prose median | Completion median | Completion range |
| --- | ---: | ---: | ---: | ---: |
| First discovery | 5.342 | 5.342 | **7.544** | 6.293–11.417 |
| Event assessment | 4.561 | 6.914 | **7.993** | 6.734–9.682 |
| Directions | 5.097 | 6.140 | **8.136** | 7.185–12.548 |

Across these 15 API turns, completion median is 7.972 seconds, maximum 12.548;
headers arrive in 0.658–1.297 seconds. Seven of 15 first artifacts arrive within
the provisional five-second target. This small cohort does not estimate a
production p95. Raw per-turn observations are:

| Trial | Locale | Turn | Headers | First artifact | First prose | Final |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | en | 1 | 1.253 | 8.876 | 8.876 | 11.417 |
| 1 | en | 2 | 0.689 | 5.366 | 7.636 | 9.682 |
| 1 | en | 3 | 1.109 | 10.073 | 10.969 | 12.548 |
| 2 | es | 1 | 0.724 | 5.923 | 5.923 | 7.972 |
| 2 | es | 2 | 1.122 | 4.561 | 6.914 | 7.993 |
| 2 | es | 3 | 1.071 | 5.097 | 6.140 | 8.206 |
| 3 | en | 1 | 0.888 | 5.342 | 5.342 | 7.544 |
| 3 | en | 2 | 1.024 | 4.387 | 5.453 | 6.734 |
| 3 | en | 3 | 1.118 | 5.535 | 6.471 | 8.136 |
| 4 | es | 1 | 0.939 | 4.657 | 4.657 | 6.951 |
| 4 | es | 2 | 1.014 | 4.246 | 5.380 | 7.150 |
| 4 | es | 3 | 0.779 | 4.866 | 5.872 | 7.185 |
| 5 | en | 1 | 1.297 | 4.206 | 4.206 | 6.293 |
| 5 | en | 2 | 0.970 | 5.494 | 7.380 | 8.709 |
| 5 | en | 3 | 0.658 | 4.681 | 5.627 | 7.194 |

The browser's composer became visible after 1.584 seconds. Discovery,
assessment and directions completed at 7.848/7.105/6.738 seconds; first progressive
packets arrived at 5.630/4.209/4.465 seconds and first prose at
5.630/5.507/5.563 seconds. The composer was ready 3–7 ms after the completion
poll observed the final response, subject to polling granularity. The expected
page/title, nonblank content, visible cards/directions and absence of an error
overlay were verified at 1440×1000 with no page errors. Browser plugin was
unavailable; existing Playwright was used against production, with no dev server.
The screenshot is `/tmp/ba-chat-startup-profile-production.png`.

Three semantic jazz searches completed in 8.711/9.813/9.121 seconds, with first
cards at 6.008/5.906/6.935 seconds. Search reads took 1.628/1.421/1.303 seconds.
Two captured reranker records took 0.134/0.192 seconds; the third breakdown is
unknown. Repeating the same wording did not make total completion consistently
faster. Do not attribute that variation solely to caching.

### Where the time is spent

All 21 turns use **model selection → one read → model prose**. Model/tool
durations below use sibling spans, not enclosing agent/step spans added again.
Server stage distributions include all three cohorts. A missing stage stays
unknown; zero means no measurable advance at the available Worker clock
resolution, not proof of free work. Scopes overlap and their medians must not be
added. Cross-service/client wall-clock intervals are explicitly approximate.

| Stage | Median | Range | Measured / 21 | Meaning |
| --- | ---: | ---: | ---: | --- |
| Ingress delivery handshake | 0.932 s | 0.643–1.284 | 17 | Includes forwarding/object setup; overlaps admission |
| Workflow creation acknowledgement | 0.604 s | 0.285–0.952 | 20 | Time spent awaiting creation/status acknowledgement |
| Durable admission to generation dispatch | **1.239 s** | **0.838–4.356** | 18 | Persisted reference on the same object; includes creation/scheduling/dispatch |
| After creation acknowledgement to dispatch | 0.703 s | 0.335–3.698 | 18 | Subset of the preceding interval |
| Workflow entry to dispatch, approximate | 0.216 s | 0.099–0.432 | 14 | Separates some post-entry engine/RPC work |
| Dispatch to application execution entry, approximate | 0.248 s | 0.216–0.477 | 15 | Routing/module entry combined |
| Application execution entry to model start | 0.367 s | 0.223–1.212 | 16 | Rate admission, lifecycle and context preparation |
| Rate-limit admission | 0.158 s | 0.121–0.676 | 17 | Preserve the fail-closed quota boundary |
| Guest lifecycle setup | 0.135 s | 0.097–0.356 | 19 | Includes its existing bounded debug/lifecycle write |
| Shared context preparation | 0.107 s | 0–0.269 | 18 | Includes rehydration; not independent of execution setup |
| Trace flush | **0.194 s** | **0.128–1.294** | 18 | Still awaited after generation |
| Checkpoint storage | 0.089 s | 0.047–0.249 | 16 | Persistence required for recovery |
| Checkpoint ready to commit dispatch, approximate | 0.074 s | 0.059–0.234 | 17 | Separate completion stage |
| Commit gate | 0.038 s | 0.023–0.049 | 17 | Subset of commit request |
| Commit request entry to final write | 0.042 s | 0.027–0.056 | 17 | Excludes forwarding and final delivery to the client |

Request-entry/session/body work, provider import and tracing initialization
recorded no measurable clock advance in their available markers. Module
evaluation/platform scheduling before entry remain outside those local clocks;
this does not prove there were no cold-start costs. Submission to first model
span is approximately 2.272–6.816 seconds (median 2.668, all 21). Last model end
to client final response is approximately 0.585–1.748 seconds (median 0.783).

| Task | First model median/range | Authoritative read median/range | Final model median/range | Count |
| --- | ---: | ---: | ---: | ---: |
| Search, all modes | 1.304 / 1.115–2.126 s | 1.303 / 0.538–2.631 s | 1.700 / 1.533–3.324 s | 9 |
| Event assessment | 1.606 / 1.561–1.985 s | **0.111 / 0.098–0.364 s** | 2.536 / 1.904–3.704 s | 6 |
| Directions | 1.652 / 1.461–2.472 s | **0.140 / 0.109–0.501 s** | 1.572 / 1.410–1.786 s | 6 |

Directions spend 3.214–3.882 seconds in their two model calls (median combined
3.328). The model's first chunk arrives in 0.764–1.440 seconds per call, but can
be hidden reasoning or tool arguments and is not a visible answer.

The slowest turn, 12.548-second directions, decomposes into approximately
6.816 seconds before the first model, 3.882 seconds in model calls, 0.501 seconds
reading directions and 1.349 seconds afterward. Its durable-admission/dispatch
interval alone is 4.356 seconds. The first discovery's 11.417 seconds contain
4.595 seconds before the model, 3.520 seconds in model calls, 2.631 seconds in
search and 0.671 seconds afterward. Long requests have different causes.

### A reproducible generic-search detour

The first English discovery sent tool query `events in Buenos Aires this week`
with the separate week filter. The deterministic canonicalizer left
`buenos aires` as semantic residue, and production logs confirm semantic search
plus reranking: 2.631 seconds for the read, including a 0.182-second reranker.
The Spanish tool query `eventos en Buenos Aires` leaves the same residue in an
offline reproduction; its production read took 2.304 seconds, but its retrieval
mode log was not captured. Later generic queries omitted the query string and
their reads took 0.538–0.811 seconds. These are observations across varying
requests, not a matched estimate of causal savings.

A network-disabled probe reproduces both city-only residues and confirms that
specific jazz wording and the event title `Buenos Aires Social and Political
Walk` still contain meaningful residue. A correction must narrowly distinguish
broad city-only discovery from named titles/genres, preserving dates, neighborhoods,
budget, exclusions and actual semantic intent. Blindly deleting city words from
every query would damage title matching.

### Applied AI engineering research and ranked options

I used Exa to review 45 search matches across three workstreams: agent/provider
execution, platform/runtime waits, and evaluation/reliability. Different URLs for
the same research are not independent evidence. Recommendations use original
papers, official documentation and the measured application path; third-party
roundups and model/vendor rankings were excluded. The older Anthropic agent
article is used for its architectural distinction, with current provider and
platform behavior checked separately. Source snapshots and a deduplicated URL
index are retained with the profiling receipt.

| Priority | Technique and application here | Addressable measured work | Tradeoff / next check |
| --- | --- | --- | --- |
| 1 | Use direct, authoritative reads for unambiguous directions; use one grounded prose call for narrow event assessments | Directions: 3.214–3.882 s of model work. Assessments: 1.561–1.985 s of initial selection work | Only a validated server-owned reference and narrow intent qualify; ambiguity stays on the normal clarification/agent path |
| 1 | Canonicalize generic city-only discovery into filter-only retrieval | The observed semantic detour reads were 2.304–2.631 s versus 0.538–0.811 s for later generic reads | Add bilingual city-only positives and title/genre negatives; preserve every hard constraint and ranking contract |
| 2 | Start the owned producer after durable input and confirmed Workflow admission, using Workflow for joining/recovery | Targets the post-acknowledgement dispatch wait: median 0.703 s, maximum 3.698 s | Higher delivery complexity; retain one owner/fence, Stop, replay, durable checkpoint and exactly one authoritative final publication |
| 3 | Return the result without awaiting trace flush; retain bounded export with the platform lifecycle hook | Median 0.194 s and observed maximum 1.294 s on final completion | Does not improve first prose already streamed; prove trace delivery and cancellation cleanup survive |
| 4 | Compare thinking enabled with low effort, or disable thinking only in a locked final-prose step | Savings unknown; removes less reasoning than disabling the whole turn | Offline wire support is proven; latency and grounded answer quality still need the same repeated-trial comparison |
| 5 | Shorter answers, stable prompt prefixes, request-local lookup reuse and independent I/O overlap | Secondary opportunities; no isolated saving measured | Preserve full source evidence and dependencies; do not parallelize a response before its source read |
| Defer | Placement changes, new model vendor, full-answer cache or wholesale delivery replacement | No measured causal saving for these choices | Avoid introducing more moving parts before removing existing serial work |

The opportunities above are not additive predictions or verified speedups.

**Why direct reads first.** Anthropic distinguishes predictable workflows from
model-directed agents and recommends increasing complexity only when needed;
its tool guidance also recommends consolidating frequently chained operations.
Those principles fit a directions request whose target is already known.
This is our application-specific inference from the measured two-call path.
Keep the current tool read and canonical assembler, and replace unnecessary
model selection/prose with a factual destination/maps template. Assessment
questions still get a source read and one prose call; do not answer them from
untrusted prior text. See [agent design](https://www.anthropic.com/engineering/building-effective-agents)
and [tool design](https://www.anthropic.com/engineering/writing-tools-for-agents).

A limited source spot-check also found that the browser directions answer added
nearby-landmark and bus/subway commentary while its successful read supplied the
destination/address/maps link. Those additions were not supported by that read;
this does not establish that they are geographically false. A factual directions
template avoids that class of unsupported embellishment as well as model calls.
This single spot-check is not a human-rated quality benchmark.

**Why retain durable recovery.** Cloudflare documents retryable steps and
idempotency requirements, and warns that Durable Objects can restart and lose
memory. Starting a producer earlier must persist its input/ownership first;
paid work still waits for confirmed recovery admission. The arriving Workflow
must join that owner or recover an expired lease, rather
than start a second generation or commit before its checkpoint exists. A bare
background promise is not a recovery mechanism. These are design requirements,
not a proposed patch already proved correct. The creation acknowledgement
remains on the critical path in this conservative first experiment; the full
1.239-second median admission/dispatch interval is not its predicted saving.
See [Workflow rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
and [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).

**Why trace export can move.** Langfuse explicitly supports retaining `flush`
with `waitUntil` so an application can return first. Cloudflare distinguishes
HTTP Worker lifecycle limits from Durable Object and Workflow execution; apply
the right owning context and retain bounded cleanup rather than abandoning
export. The current code already retains tracing cleanup but still awaits its
flush before returning generation. See [Langfuse serverless guidance](https://langfuse.com/faq/all/aws-lambda-and-serverless-functions)
and [platform invocation limits](https://developers.cloudflare.com/workflows/reference/limits/).

**A better compute experiment than blanket thinking-off.** DeepSeek documents
thinking enabled/disabled separately from `reasoning_effort` low/high/max, with
high as its documented default. A zero-network transport probe using the
installed SDK confirms `thinking: enabled`, `reasoning_effort: low` and the
unchanged 8,192-token cap reach the wire. That proves compatibility, not model
quality or speed. The installed SDK's step hook also supports provider options
and tool controls, enabling a separate experiment that preserves reasoning for
selection and locks tools off only after a successful terminal read. Retain
required reasoning content in tool-call history; do not prune it blindly.
Temperature tuning does not control this provider's thinking mode. See
[DeepSeek thinking controls](https://api-docs.deepseek.com/guides/thinking_mode/)
and [AI SDK loop controls](https://ai-sdk.dev/docs/agents/loop-control).

**Where caching/parallelism helps.** Provider metadata reports 166,092 total
input tokens, of which 99,455 (59.9%) were cached, plus 8,145 output tokens in
42 model calls. Reasoning tokens are not separately reported in these production
observations. DeepSeek already enables prefix caching by default; stable
instructions/schemas can improve reuse, but output is still generated. A full
answer cache would need freshness and reference/identity isolation absent from
this experiment. AWS's execution-path guidance supports overlapping independent
I/O and deduplicating lookups; the actual read must still precede grounded prose.
See [DeepSeek caching](https://api-docs.deepseek.com/guides/kv_cache) and
[execution-path optimization](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentperf02-bp03.html).

**Why placement is deferred.** Worker placement can reduce backend round trips,
but it does not automatically optimize all RPC/named entrypoints. Durable Object
location hints are best-effort, only apply at first creation, and the current
documentation says South America hints are served from a supported nearby
region rather than spawning there. We did not measure object placement or
prove that it caused the dispatch gap. See [Worker placement](https://developers.cloudflare.com/workers/configuration/placement/)
and [Durable Object locations](https://developers.cloudflare.com/durable-objects/reference/data-location/).

**Quality acceptance remains separate.** Original research identifies position,
verbosity and self-enhancement biases in model judges. That does not prove any
specific bias caused our earlier grades, but reinforces why the observed judge
errors cannot establish quality equivalence. Run the existing three-trial
bilingual suite with retained failures, add city-only/title/genre and direct-read
edge cases, and inspect a small blinded answer set against captured sources.
Keep the structured grounding and ambiguity checks alongside prose review.
See [MT-Bench judge analysis](https://arxiv.org/html/2306.05685v4).

### Decision and receipts

The initial recommendation was to implement the narrow directions path and generic-discovery correction as the
next change, then rerun the same production prompts to verify actual end-to-end
improvement. Extend to one-call assessments once source/ordinal behavior is
verified. Plan producer startup separately because it changes delivery ownership.
Use low-effort and final-prose-only thinking changes as controlled comparisons,
not automatic production switches. The current release applies instrumentation
only; none of these proposed optimizations is claimed implemented.

Private receipts, rerunnable profiling/analysis scripts, retained setup and
collection failures, source snapshots and hashes are under
`results/releases/startup-production-20261018/`. Langfuse v2 supplies all 147
observations; an initial legacy-endpoint request returned HTTP 410 and was
corrected using the published migration. Some metadata exports through the
tool were truncated; compressed transfers were decoded and checked against
their original record counts before analysis. Missing individual timing markers
remain unknown with the denominators above. Langfuse's existing release label
still reports `85399349...`; actual deployed source is established by the new
Worker version IDs and correlated timing logs, not that stale label.

## Broader chatbot architecture review on October 18 2026

**Revised recommendation: retain the single, model-directed tool loop. Do not
prioritize a hand-written phrase router or bypass the agent for free-text event
assessments. First evaluate changes within the existing loop and remove measured
nonessential work from the response path. Treat direct tool completion and earlier
producer startup as separate, quality-gated experiments.** This section supersedes
the initial optimization ordering above, without replacing its measurements.

This is research and a local documentation update. No runtime, model settings,
dependencies, production ownership rules or deployments changed in this review.
The duplicate-card implementation and earlier thinking experiment retain their
previous local/release status.

### Research method and evidence strength

Exa returned 85 search matches from 17 searches across four workstreams:
architecture/routing, tool-loop latency, startup/reliability, and conversational
evaluation. Exact-URL deduplication gives 82 search URLs; that is a discovery
count, not 82 validated or independent sources. I retrieved 27 primary-source
pages representing 26 documents, treating the ACL paper's landing page and PDF
as one document, and cross-checked runtime guidance with Cloudflare's documentation
search. Bounded text snapshots, queries, URL records and coverage counts are in
`results/releases/chat-best-practices-research-20261018/sources.json`.

The evidence includes official framework/provider documentation, first-party
engineering reports, peer-reviewed industry research and one recent production
preprint. Official documentation establishes supported mechanisms, not comparative
performance. Vendor case studies have commercial incentives and workload-specific
results. Older papers establish methodological concerns, not current model rankings.
Third-party summaries, model leaderboards and feature claims from incompatible
providers are not used to justify a production change.

### What the sources establish

**A model/tool/model cycle is normal.** OpenAI's agent track describes selecting a
function, executing it in application code, returning its result to the model and
generating a response. AI SDK documents the same bounded loop and per-step control.
Anthropic recommends simple, composable systems and explicitly distinguishes the
flexibility of agents from the predictability of workflows. There is no established
rule that two model requests per tool-using chat turn is excessive. Our 21-turn
sample's two requests are evidence of latency allocation, not an architecture defect.
See [OpenAI agent development](https://developers.openai.com/tracks/building-agents),
[AI SDK loop control](https://ai-sdk.dev/docs/agents/loop-control) and
[Anthropic agent patterns](https://www.anthropic.com/engineering/building-effective-agents).

**Keeping business rules in code does not imply parsing free text with phrase
rules.** Rasa's CALM documentation separates contextual language understanding
from deterministic execution: the model interprets the conversation and proposes
commands, while application flows own execution. Its dialogue guidance highlights
ambiguity, corrections and overlapping intents. Google's conversation design
guidance emphasizes contextual follow-ups and references to visible content.
These support retaining model understanding for event pronouns, mixed requests
and language variation. They do not prove every narrow rules-based shortcut is
bad, but they do not validate my proposed English/Spanish phrase list either.
See [CALM](https://rasa.com/docs/learn/concepts/calm/),
[dialogue understanding](https://learning.rasa.com/rasa-pro/dialogue-understanding/)
and [conversation context](https://developers.google.com/assistant/conversation-design/learn-about-conversation).
The last source describes an older voice-product setting; only its general
conversation principles are applied here.

**A separate classifier is a real subsystem, not free certainty.** The EMNLP
industry paper *Intent Detection in the Age of LLMs* evaluates supervised and
LLM-based intent recognition on six datasets, including real production data,
and proposes uncertainty-based routing. Its reported tradeoff depends on learned
classifiers, negative examples and calibrated uncertainty, rather than a few
regular expressions or an assumed confidence score. It is not a benchmark of
our bilingual event follow-ups. At this application's size there is no evidence
that adding such a classifier is better than retaining the existing first model
call. See the [original paper](https://aclanthology.org/2024.emnlp-industry.114.pdf).

**Reduce avoidable decisions within tools before replacing understanding.**
OpenAI recommends passing already-known arguments in code and combining functions
that are always called in sequence. Google recommends wrapping deterministic
API chains in one tool/callback. Anthropic recommends distinct, task-shaped tools,
meaningful return values and evaluating tool changes against realistic outcomes.
For BA, reference validation, visibility, date/filter rules, saved-state authority
and canonical presentation should remain in code. Do not collapse a genuinely
conditional search/details/directions sequence merely to reduce a call count.
See [function design](https://developers.openai.com/api/docs/guides/function-calling),
[Google tool patterns](https://docs.cloud.google.com/customer-engagement-ai/conversational-agents/ps/best-practices)
and [Anthropic tool engineering](https://www.anthropic.com/engineering/writing-tools-for-agents).

**A ready-to-display tool result can end a turn without a second model call.**
LangChain documents `returnDirect`: the model still interprets the request and
selects the tool, but an already complete tool answer returns directly to the user.
Its guidance explicitly excludes results needing further reasoning, summarization
or chaining. This is a more appropriate directions experiment than manually
classifying free text before the agent. It is a pattern to implement in our
existing AI SDK runner, not a recommendation to add LangChain or assume its option
exists on AI SDK tools. See [direct tool returns](https://docs.langchain.com/oss/javascript/langchain/tools).

**More structured orchestration can improve quality, so fewer calls is not the
sole objective.** An ACL 2025 e-commerce case study compares a basic tool-calling
agent, workflow graphs and graph-specific fine-tuning on 161 conversations/2,100
turns. Structure improves tool/format results in that setting; larger advertised
gains also include fine-tuning, and human preference is weaker for regular chat.
A September 2026 accommodation-support preprint reports a bounded orchestrator
plus separate generator on live multilingual traffic. It attributes latency gains
to serving changes and explicitly disclaims a pure causal architecture comparison.
Neither establishes that we should add a graph or another agent. Both challenge
the assumption that merging decisions and wording into one call is automatically
best. See the [ACL case study](https://aclanthology.org/2025.acl-industry.107.pdf)
and [production migration preprint](https://arxiv.org/html/2609.05758v2).

**Tune reasoning and actual output, rather than treating the token ceiling as
answer length.** DeepSeek separately exposes enabled thinking and low/high/max
effort; its documented default is high. AI SDK's `prepareStep` supports changing
step settings, and the installed provider supports `reasoningEffort`. Our previous
offline transport probe establishes wire compatibility, not a quality or speed
gain. Our blanket-thinking-off experiment failed behavioral checks, so it remains
rejected. Test enabled/low effort with the same loop before adding a separate
simple-turn classifier. A final-prose-only setting is a later experiment requiring
a reliably terminal successful read. Keep required reasoning history, grounding,
output limits and cancellation. Concise answers can reduce generated work; simply
lowering 8,192 to another ceiling may only truncate valid reasoning without
shortening normal answers. See [DeepSeek controls](https://api-docs.deepseek.com/guides/thinking_mode/),
[AI SDK controls](https://ai-sdk.dev/docs/agents/loop-control) and
[OpenAI latency principles](https://developers.openai.com/api/docs/guides/latency-optimization).
OpenAI's latency heuristics are not numerical predictions for DeepSeek.

**Streaming, context selection and caching are useful, but not new discoveries
for this app.** BA already streams trusted previews and prose, projects source
descriptions without redundant representations, bounds dialogue and uses a provider
with automatic prefix caching. Preserve these. Do not call a typing indicator or
the unwanted repeated card a useful answer. Preserve full relevant source evidence
when slimming tool results; the original source description can be necessary to
answer assessments. Cache stable instructions/schemas where feasible, but actual
cache hits and output generation still determine the result. No full-answer cache
or extra summarizer is justified by our short-turn sample.
See [context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
and [DeepSeek cache behavior](https://api-docs.deepseek.com/guides/kv_cache).

### Startup and recovery: what changes are actually supported

Cloudflare's chat architecture persists messages in a Durable Object and starts
streaming from its chat handler; its Workflows integration assigns real-time
communication to Agents and independently retryable multi-step work to Workflows.
Current recovery documentation also describes persisted fibers and recovery hooks.
These establish that durable chat need not universally wait for a new Workflow
callback. They do not establish feature parity with our deployed package, our
authoritative commit protocol, DeepSeek's interrupted streams or Telegram delivery.
The repository pins `agents` 0.22.0; current documentation cannot be treated as
proof that every described feature is available in that installed version.
See [Cloudflare chat](https://developers.cloudflare.com/agents/communication-channels/chat/chat-agents/),
[Workflow integration](https://developers.cloudflare.com/agents/concepts/workflows/)
and [recovery patterns](https://developers.cloudflare.com/agents/concepts/agentic-patterns/long-running-agents/).

Our measured post-admission callback gap (median 0.703 s, maximum 3.698 s over
18 measured turns) justifies an isolated experiment. It does not identify how
much is scheduler delay, placement, transport or application execution, and does
not prove an earlier-start producer would remove the entire gap. The initial
proposal adds ownership, joining and recovery coordination to a path that
currently cancels/replaces an active producer. Keep it separate from model tuning;
compare a minimal earlier-start prototype against the existing path before
recommending adoption. Require Stop, reconnect, restart before/after checkpoint,
duplicate callback and stale-owner publication tests. Recovery may repeat model
work; fencing prevents accepted stale writes but is not exactly-once billing.

Inngest's first-party engineering write-up independently discusses step-transition
overhead and local execution/checkpoint tradeoffs. Its published timing claims are
vendor/workload-specific, not evidence of Cloudflare scheduler internals, and do
not justify moving our authoritative checkpoint writes to unowned background work.
See [durable execution latency](https://www.inngest.com/blog/eliminating-latency-ai-workflows).

Trace export is a smaller, clearer opportunity: Langfuse explicitly documents
returning while a platform lifecycle hook retains `flush()`. Our implementation
awaits flush in `traceConciergeRun`'s `finally`, despite already retaining the
execution promise. Refactor the result path to retain a separate bounded export
promise, preserving span completion and abort cleanup. The measured median
0.194 s (18 measurements; maximum 1.294 s) is addressable tail work, not a proven
end-to-end saving or an improvement to already streamed prose. See
[Langfuse serverless lifecycle](https://langfuse.com/faq/all/aws-lambda-and-serverless-functions).

### Revised order of work and acceptance criteria

| Order | Proposal | How it would be implemented | Decision and uncertainty |
| --- | --- | --- | --- |
| 1 | Preserve the agent and fix known product/retrieval waste | Finish the separate repeated-card release; normalize only generic city-only search residue inside the existing search tool | Retains contextual language understanding. City/title/genre and bilingual negatives must pass; no matched speedup is yet measured |
| 1 | Remove trace export from user completion | Finish spans, retain a separately bounded flush with the owning runtime hook, and return the generation result without awaiting export | Strong documentation and measured tail work; verify exports survive normal completion and cancellation |
| 2 | Compare thinking enabled with low effort | Explicit eval-only provider setting using the same prompt, model, history, tools and limits; no phrase classifier | Small implementation change, unknown quality/latency result; no production switch until accepted |
| 3 | Evaluate complete tool answers | Let the model choose a directions completion tool; successful, complete output ends the loop and is assembled as a trusted localized response | Saves only the final prose call, retaining interpretation. Do not terminate compound requests or failed reads; no new framework |
| Separate | Investigate and prototype earlier startup | Use existing timing boundaries and controlled runs; compare a persisted owner/join design with the current Workflow dispatch | Real measured delay, materially larger recovery change; source guidance does not establish our proposed design is correct |
| Defer | Phrase router, extra classifier, blanket prefetch, multi-agent split or platform migration | No implementation proposed in this checkpoint | No app-specific evidence that complexity, false routing and unnecessary reads are worth the savings |

For direct completion, AI SDK's stopping condition alone is insufficient: the
current assembler marks empty model prose as a planner fallback. A future patch
must explicitly represent a successful terminal artifact, create localized text
from verified fields, retain read provenance and emit the normal canonical
response. A terminal tool must mean the entire request is satisfied; indiscriminately
stopping after every `get_directions` would break compound requests and recovery
from failed lookups. This is an implementation requirement, not a completed design
or a claim that all intent ambiguity disappears.

Evaluate changes one at a time against the existing repeated-trial bilingual
suite, extending it with paraphrases, negation, mixed requests, two possible
events, ordinal references, corrections, topic changes, missing descriptions,
hidden addresses, failed tools and cancelled reads. Check the final task outcome,
the actual target and source-supported facts, not only whether a tool name appears.
Keep mandatory grounding/authorization checks, but allow valid alternative paths
where the product contract permits them. Add a held-out set drawn from actual
chat failures; supplement synthetic variations with source-based blinded human
review rather than declaring a model judge independently calibrated.

Report time to first useful output and complete response separately, with failure
counts, model/tool calls, reported token/cache usage and repeated-run consistency.
Keep complete conversations as the unit for follow-up correctness. Repeat live
end-to-end measurements only after the candidate passes offline checks; stratify
first/follow-up, task, locale and guest/authenticated paths. Neither the existing
21 sequential turns nor a synthetic timing model estimates customer p95 or
controlled cold-start performance.

This follows [Anthropic's evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
and the [tau-bench methodology](https://arxiv.org/abs/2406.12045), using the latter
for repeated interactive outcome evaluation rather than its historical model
rankings. Microsoft's [multi-turn research](https://www.microsoft.com/en-us/research/publication/llms-get-lost-in-multi-turn-conversation/)
supports testing corrections and progressive specification, but its six generation
tasks and simulated conversations do not establish a failure rate for BA.
OpenAI's [support-agent optimization cookbook](https://developers.openai.com/cookbook/examples/agent_optimization/optimizing_agents_for_cost_and_quality)
also recommends joint quality/latency checks; its default fixture labels, modeled
latencies and formula-derived scores are explicitly a teaching simulation, not
evidence that a real router or model optimization succeeds.

The core decision is to optimize the measured implementation while preserving
the model's conversational understanding. Direct UI actions can use deterministic
code because intent is supplied explicitly; free-form messages should keep the
general tool loop unless an evaluated alternative earns its complexity.

## Practitioner follow-up before optimization work on October 18 2026

The owner authorized the optimization work and a separate startup experiment,
requesting another research pass first with an emphasis on people who have shipped
comparable conversational products. Exa returned 80 matches from 16 searches
across travel/discovery, support deployments, independent practitioners and
interactive runtimes. There are 72 exact search URLs and 19 retrieved primary
pages, including author-affiliation verification. These are discovery counts,
not independent confirmations. Query records, bounded text snapshots and
per-source credibility/transfer limits are retained in
`results/releases/practitioner-chat-research-20261018/sources.json`.

### What shipped-product builders report

| Practitioner / shipped product | Evidence | Implication for BA |
| --- | --- | --- |
| Natalie Halimi, Booking.com AI Trip Planner | First-person account says early rules/restrictions made the product feel like a decision tree and produced repetitive conversation; almost 200 internal testers helped refine the experience | Retain contextual model understanding; do not introduce a phrase router merely to save a model call |
| Alex Specht, Tripadvisor AI trip builder | Reports a move to a review-based recommendation model, roughly 40 to 6.5 s average latency, with better recommendation/save/customer metrics | Optimize retrieval and recommendation work independently of wording; the reported gains come from a different recommendation architecture and are not a speed forecast for BA |
| Kesha Mykhailov, Intercom Fin | First-person engineering account on Honeycomb's site: eager processing saved two seconds median first-token latency, but unnecessary eager calls later damaged margins and were discovered by Finance | Startup experiments must preserve admission, own the exact request and count discarded/repeated work, including attempts that never produce a visible response |
| Pedro Tabacof, Fin | Randomized latency experiments found response delay affected both abandonment-related resolutions and positive feedback | Do not treat silence, deflection or an isolated helpfulness vote as proof that a faster variant preserved answer quality |
| Gregoire Lambert, Alan support agents | Reports 100,000+ automated conversations; domain specialists read and annotate real transcripts; their early model-judge trial did not work well | Keep actual source-based human review and real-chat failure cases alongside automatic checks |
| Robin Monnier, Onepilot cofounder/CIO | Describes a router choosing only one of two requests, and a tool failure poisoning persisted tool-call history; affiliation checked against the author's About page | Explicit mixed-request and failed-tool/recovery tests matter more than matching a few happy-path phrases |
| ChatGenie Engineering | Reports replacing a five-agent chain with a guard plus unified orchestrator, over 50% lower latency and unchanged 98% eval accuracy | Avoid adding classifier/reviewer calls without evidence. Their reported figures lack a public sample/rubric and start from a different architecture |
| Marcus Huang, Respan | Same-model product rewrite improves their judge rubric grades but table reports latency rising from 19.8 to 38.8 s | A simpler architecture is not automatically faster. Rubric scores are not success percentages; tool loading/prompts changed too |
| Kapa team, own in-product analytics agent | Tools are designed from real user questions and can produce structured inline components | Use task-shaped, trusted results and preserve UI presentation; this does not by itself prove direct completion is safe for compound requests |
| Inkeep maintainers | Explicitly distinguish request-local streaming and durable workflow execution; publish approximate TTFB tradeoffs | Separate transport first-byte timing from useful output and test restart recovery; their approximate timings are not BA savings |
| Trigger.dev maintainers | Describe durable input/output streams, replay cursors, per-turn snapshots and explicit idempotency responsibilities | Replay and recovery are distinct from a warm process; retain authoritative persistence while experimenting with earlier generation |
| Gorgias / implementation partner Spiral Scout | Describes a spike before production durable agent actions, preserving asynchronous waits and context | Test ownership/recovery independently; do not remove durability merely because the happy path is slower |

The Booking.com [product account](https://medium.com/booking-product/8-weeks-to-innovation-lessons-from-building-booking-coms-ai-trip-planner-94adbf138748)
and Tripadvisor [shipped trip-builder report](https://medium.com/tripadvisor/cracking-the-code-to-the-ai-travel-planner-27d8d0f222c8)
are the closest discovery-product matches. Both are self-reported product
experiences, not controlled evaluations of our agent design. Booking.com's
[industry paper](https://aclanthology.org/2025.acl-industry.48.pdf) also reports
task-specific distillation/speculative decoding and online tests, but those
require inference/training controls we do not have through the hosted DeepSeek API.

Fin's [eager-request account](https://www.honeycomb.io/resources/case-studies/how-honeycomb-helped-intercom-observe-and-operate-fin-ai)
is particularly relevant to startup: its two-second gain is a practitioner claim,
not permission to start our paid work before rate/identity/recovery admission.
Its [latency experiment](https://fin.ai/research/does-slower-seem-smarter-rethinking-latency-in-ai-agents/)
does not justify artificial delays. Its [small reasoning-model engineering](https://fin.ai/research/think-fast-reasoning-at-3ms-a-token/)
optimizes self-hosted GPU inference and cannot establish quality equivalence for
our proposed lower-effort setting.

Alan's [support lessons](https://medium.com/alan/five-hard-won-lessons-from-automating-100-000-care-conversations-with-ai-856b86782146)
and [internal operations-agent account](https://medium.com/alan/how-we-bootstrapped-an-ai-agents-platform-for-operations-at-alan-fefd87ed6314)
have different risk/workflow constraints. The latter specifically emphasizes
stateful outcomes and application-enforced permissions; it is not evidence to
answer travelers with fixed macros. Onepilot's [incident notes](https://robinmonnier.com/field-notes-from-running-customer-support-ai-in-production)
are technically specific but anecdotal; the author's [affiliation](https://robinmonnier.com/page/about)
supports firsthand attribution rather than independent validation of scale claims.

[ChatGenie's simplification](https://chatgenie.ph/post/how-we-cut-latency-by-50-by-simplifying-our-agentic-architecture)
and [Respan's rewrite](https://www.respan.ai/blog/from-five-agents-to-one-loop)
are useful counterpoints: fewer orchestration layers sometimes help, but measured
latency can worsen even as their chosen quality grades improve. Neither supports
claiming a blanket architecture speedup. Both sell related products.

[Kapa's own-agent lessons](https://docs.kapa.ai/dev/agent/in-product-agent-best-practices),
[Inkeep tuning](https://docs.inkeep.com/guides/agent-engineering/tuning-agents),
[Inkeep execution modes](https://docs.inkeep.com/visual-builder/execution-modes),
[Trigger.dev's runtime mechanics](https://trigger.dev/docs/ai-chat/how-it-works)
and the [Gorgias implementation account](https://spiralscout.com/case/ai-agentic-automation-ecommerce-support)
describe concrete shipped mechanisms. They remain commercially interested reports,
not evidence to change platforms or copy their provider defaults. In particular,
Inkeep's generic reasoning-off advice cannot overrule our own failed thinking-off
comparison. The older [Applied LLMs practitioner synthesis](https://applied-llms.org/)
helps frame real-world evaluation and retrieval, but includes third-party examples
and is not counted as independent corroboration of each cited result.

### Consequences for the authorized experiments

Proceed with the existing loop, narrow search-tool correction and retained trace
export. Compare enabled/low reasoning with the same bilingual corpus before any
production setting change. Keep complete-tool-answer experiments distinct from
assessments and mixed requests. Prototype earlier generation only after confirmed
Workflow admission, and require the arriving callback to join existing work rather
than restart it. Retain encrypted input, ownership fencing, checkpoints, Stop and
atomic final publication. Record speculative/repeated executions, failed admission
and actual useful output. Test deterministic dispatch delay separately from live
latency; a simulated gain is not a measured production improvement.

## Authorized local optimization checkpoint on October 18 2026

The practitioner review above preceded this implementation. The production model,
its thinking setting and Worker deployments were not changed. The following local
changes retain the model-directed loop and the earlier repeated-card fix:

- Generic discovery uses filter-only retrieval when recognized query scaffolding
  leaves only unquoted `buenos aires`. The same span annotator records the consumed
  city phrase. Specific titles, quoted names, genres, explicit preferences and all
  hard filters remain. Bilingual positive and negative cases exercise this boundary.
- Generation returns without awaiting a separately retained, bounded trace flush
  when a real runtime hook exists. CLI/missing-hook and hook-failure paths still
  await export. The HTTP boundary no longer supplies a no-op hook outside
  Cloudflare. Success, interruption and failing/missing retention fixtures verify
  cleanup without repeating generation. No claim of a measured production saving
  is made before a release/trace-delivery check.
- Low effort and complete directions are explicit server/evaluation injections.
  Public input cannot select them; the default configuration is unchanged, and
  configuration fingerprints identify each candidate. Transport tests use the
  real installed SDK and synthetic responses without external network access.
- The directions candidate lets the model select a completion argument on the
  existing tool. It can end only after one successful directions result, without
  earlier successful non-directions reads needing explanation. Assembly supplies
  localized map guidance from the trusted artifact rather than treating empty
  model prose as failure. Failed lookup recovery, ambiguity, compound requests,
  both tool orders and both locales have deterministic real-SDK fixtures. This
  does not introduce a phrase classifier or a second framework.

### Enabled thinking with low effort: rejected

Receipt `thinking-99261389-ae5d-417c-8735-b1632d526d0c` runs the same eleven
bilingual conversations three times per setting, alternating whole conversations
with independent actual histories. Both settings use the same prompt, model,
source corpus, limits and streaming callback. There are 99 turns per setting;
all failed turns remain in the latency denominator. These are real model API
timings with frozen reads, excluding application HTTP/delivery, actual catalog
retrieval and database latency. They are not customer p95 estimates.

| Measure | Existing default (enabled thinking) | Enabled thinking, low effort |
| --- | ---: | ---: |
| Behavior checks | 99/99 | 96/99 |
| Fallbacks | 0/99 | 0/99 |
| Completion median | 3.565 s | 3.521 s |
| Completion sample p95 | 5.588 s | 6.417 s |
| Completion maximum | 7.444 s | 9.137 s |
| Returned model steps | 212 | 215 |
| Valid automatic prose grades | 95/99 | 94/99 |
| Prose-only automatic passes | 65/95 | 63/94 |
| Combined behavior/prose passes | 65/99 | 62/99 |
| Judge protocol/request errors | 4 | 5 |

Low effort improves median completion by 44 ms (about 1.2%) in this sample and
has a worse upper tail. It twice re-searches instead of reading the selected event
in the Spanish missing-description follow-up (trials 1 and 3). In the English
clarification-recovery case, trial 3, it produces directions when the current
request asks first for a recommendation list. The measured speed change does not
justify these behavior regressions. Keep the existing production setting.

Automatic prose grades are uncalibrated, retain their errors, and do not certify
either setting's prose. A source/trace spot-check is not independent human review.
The comparison exits nonzero because its acceptance gate fails; this is a completed
negative experiment, not a successful model-quality release. The loaded low-effort
orchestration/harness source bytes are archived and their hashes match the receipt,
separately from the later directions prototype in the working tree.

### Earlier generation: opt-in local prototype

`CHAT_EXPERIMENTAL_EARLY_GENERATION=after-admission` applies only to new attempts
and is absent from production configuration. The attempt persists its chosen
policy; changing the binding does not retrofit an existing attempt. After durable
input and confirmed Workflow admission, delivery may start generation immediately.
A later callback joins the same in-memory producer and execution fence. Restart
recovery remains owned by the original Workflow, with validated checkpoints and
atomic final publication unchanged.

An early failure before the first callback needs explicit accounting: without it,
the eager execution could buy a fourth generation on top of the existing three
workflow attempts. The prototype durably records an unobserved early failure;
the first callback consumes it as a failed attempt before any new generation.
A restart regression forces this ordering and verifies three total generation
attempts. This protects the tested retry path; it is not an exactly-once provider
billing guarantee for uncertain external responses.

Native browser/workerd checks pass with the option off and on: disconnected/reloaded
subscribers, navigation, Stop, generation reset, commit reset/checkpoint reuse,
exhausted recovery and Retry. All maintain one accepted final canonical response.
Unit checks also cover uncertain admission, Stop during admission, duplicate
callbacks, policy persistence and stale writes. Two distinct timing markers identify
early generation and joined callbacks without logging content or credentials.

`bun scripts/profile-chat-startup.ts` exercises the real delivery class, signed
in-process bindings and in-memory storage with injected 10 ms admission, 60 ms
dispatch and 120 ms generation delays, alternating three trials per setting.
Both paths produce one generation, one commit and one final publication. It
demonstrates removal of the injected wait, not Cloudflare placement/scheduler
performance or an actual production latency improvement. Keep the option off
until a separately measured deployed comparison passes the same recovery checks.

### Local verification and receipts

The full local suites pass 917 Vitest and 932 Bun tests. Svelte reports zero errors
and warnings, Effect reports zero errors/warnings with 86 informational messages,
TypeScript passes, all ten main specs validate and the production build passes.
The existing adapter deprecation notice remains. Initial fixture typing failures
and their successful repaired checks are retained. The HTTP retention-boundary
correction also passes focused checks, TypeScript and a subsequent build.

Private receipts, source snapshots, the raw low-effort failure/grade records,
browser logs, simulation and analysis script are under
`results/releases/practitioner-chat-research-20261018/`. No model/API key, database
schema, provider default, production flag or deployment was changed. The separate
directions conversation comparison follows; independent human-quality calibration
remains open.

### Complete directions: faster completion, mixed tradeoffs

Receipt `thinking-2c119022-ad4b-4d84-8131-4bf7d7b6e3eb` compares the unchanged
default and the opt-in directions candidate on two new bilingual conversations,
three trials each. Each conversation asks for three events, then directions plus
an explanation of the second event's original description, then only directions
to the third event. There are 18 turns per setting, with six of each task type.
These use real model calls and frozen source reads, not production HTTP/database
or deployed-startup measurements.

| Measure | Default | Complete-directions candidate |
| --- | ---: | ---: |
| Discovery completion median, n=6 each | 3.077 s | 3.072 s |
| Compound directions/description completion median, n=6 each | 3.620 s | 3.891 s |
| Directions-only completion median, n=6 each | 3.182 s | 2.006 s |
| Directions-only first artifact median, n=6 each | 1.471 s | 1.727 s |
| All-turn completion median, n=18 each | 3.291 s | 3.072 s |
| Returned model steps | 36 | 30 |
| Raw behavior checks | 17/18 | 18/18 |
| Valid automatic prose grades | 18/18 | 18/18 |
| Prose-only automatic passes | 13/18 | 11/18 |
| Combined behavior/prose passes | 12/18 | 11/18 |
| Fallbacks | 0 | 0 |

All six candidate directions-only turns finish with one model call rather than
two; all six compound turns keep both source reads and two model calls. The
directions-only median completion saving is 1.176 s (about 37%). However, first
map output is 256 ms slower at the median, and compound completion is 271 ms
slower. The 219 ms all-turn median improvement is not evidence of a universal
latency improvement. The existing preview path already exposes maps before final
prose, so fewer final calls principally helps turn completion/composer readiness.

The default's one raw behavior failure is a language-detector false positive on
an English directions sentence containing Spanish event/venue/address names.
The captured answer begins `Directions to`, uses English connecting text and
`open in Maps`; the source names remain Spanish. Raw results were not rewritten,
the detector was not changed during the experiment, and this is a source/trace
spot-check rather than an independently calibrated rescore. Do not claim a real
behavior-quality improvement from 17/18 to 18/18.

The automatic prose acceptance gate fails for both settings. Some flags concern
subjective atmosphere descriptions inconsistently treated as verifiable claims;
others identify concrete unsupported seating assertions. A candidate compound
answer adds that an open-air tango event is not a seated concert, which its
description does not establish. The six candidate directions-only template
answers pass their automatic prose checks, but that narrow result cannot certify
the whole conversation. Keep the feature evaluation-only until broader conversation
coverage, first-useful latency and source-based independent prose review support
promotion. Do not improve the reported result by dropping discovery or compound
failures.

Both model comparisons are complete negative release decisions, with 234 total
generation turns and 234 automatic grade rows across the two experiments. They
remain useful evidence: lower effort does not earn its quality loss here, and
direct tool completion offers a narrower completion-time opportunity with costs
that need further evaluation. The query/trace corrections and off-by-default
startup prototype are locally implemented and reviewable; no production rollout
or production latency reduction is claimed.

## Deployed search/logging fixes and controlled startup comparison, October 18 2026

**The search and retained trace-export fixes are deployed. Earlier startup removed
the measured post-admission wait in the selected test requests, but the small
live sample does not establish a dependable end-to-end improvement. Regular
traffic keeps normal startup. Thinking settings are unchanged and the directions
shortcut remains disabled.**

### Release and settings

[PR #25](https://github.com/HanifCarroll/ba-events/pull/25), merge
`d26b3b66c830e6154a53ef27e5cbeebebb2fe523`, passed native production build
`01394ecb-6ef8-47a1-abe0-2c1dc178a678` and deployed all four Workers at 100%.
Three live smoke turns completed without fallback. The actual tool result for
“events in Buenos Aires” with this-week bounds reports `filter_only`.
Specific titles, quoted names, genres and hard constraints retain their covered
behavior. This is the owner's release-specific operational exception for the
search correction; independent answer-quality labels remain unknown.

All 27 smoke observations arrived, including eight model calls matching the
actual 2/2/4-step responses. Trace export took 177–544 ms. All three responses
reached their durable checkpoint before export finished, by 7–477 ms. This
confirms overlap, not an equally sized guaranteed reduction in total latency.
The directions smoke encountered a source with no address and retained its
ordinary additional lookup behavior; that is not a shortcut or a fallback.

[PR #26](https://github.com/HanifCarroll/ba-events/pull/26), merge
`a920c143a21522d77b863f79e06e535024f638df`, passed native build
`976c9423-3356-4747-aa3f-e9653de90203`. The production model runner, provider
settings, constants and lockfile are byte-identical to PR #25. The configured
adaptive thinking alias retains its installed SDK mapping to enabled thinking.
No reasoning-effort override, directions completion argument, prompt change,
migration or credential change was deployed.

### Live comparison protocol

The plan was saved before requests: six independent conversation pairs, three
English and three Spanish, with three turns per arm (36 measured turns). Each
arm carried its own actual prior responses. Both used the same public Worker
`43c959a0-3aec-4fb1-99bb-0a62d64cb777` and delivery Worker
`f90fb2fe-f5c3-42f6-8bc5-90c83e870b91`. Arm order alternated by pair/turn.
This deterministic order was correlated with locale; it was not randomized.
Within each pair, both arms received the same locale and prompts.

The server campaign selected 18 early-start requests plus two separate safety
checks. Ordinary requests used normal dispatch. The allowlist was finite and
expiring, with no global early-start flag. Selection was persisted per attempt.
Generation began only after confirmed Workflow admission, and later callbacks
joined the existing producer under its fence. The original recovery budget,
checkpoint, Stop and publication gates remained in place.

Discovery, assessment of the first result, then directions ran sequentially
over production HTTPS SSE from this Buenos Aires client. Requests used live
source data, not a frozen corpus. New conversations were not deliberately cold
Worker isolates. This was not a concurrent-load, signed-in, mobile or browser
paint benchmark. First artifact means a structured event/venue/map/clarification
result; first prose is reported separately. Completion is the canonical final
response, excluding later trace collection and analysis.

### Client-visible results

Sample medians below average the central two observations for even sample sizes.
Historical nearest-rank receipts are retained separately and not rewritten.

| All turns, 18 per arm | Normal startup | Earlier startup |
| --- | ---: | ---: |
| Response headers | 0.975 s | 1.001 s |
| First structured result | 4.985 s | 4.198 s |
| First prose | 6.138 s | 5.127 s |
| Complete response | 7.345 s | 7.022 s |
| Slowest observed completion | 10.742 s | 10.489 s |

| Complete response by turn position | Count | Normal startup | Earlier startup |
| --- | --- | ---: | ---: |
| first | 6 per arm | 7.466 s | 6.986 s |
| followups | 12 per arm | 7.345 s | 7.273 s |

First-message artifacts appeared at medians 4.922/4.026 s;
follow-up artifacts at 4.985/4.566 s.
Across all turns, the difference between arm medians was 788 ms for first
artifacts and 323 ms for completion, about 16% and 4% respectively. These are
observed differences, not promised production gains.

Pairing the same conversation/turn gives a mean completion difference of
263 ms faster, with 11/18 early responses faster and 7/18 slower. An exploratory
bootstrap resampling the six whole conversation pairs gives a 95% percentile
interval from 869 ms faster to 536 ms slower. For first artifacts, the mean
paired difference was 509 ms faster, but its interval also includes no gain
(1,075 ms faster to 65 ms slower). Six clusters and live model variation make
these uncertain estimates, not a conclusive quality or latency acceptance test.

### Startup attribution

| Stage | Normal startup, available samples | Earlier startup, available samples |
| --- | ---: | ---: |
| Workflow admission | 547 ms (15/18) | 570.5 ms (18/18) |
| Durable input to execution fetch | 1093 ms (14/18) | 570.5 ms (18/18) |
| Confirmed admission to execution fetch | 555.5 ms (12/18) | 0 ms (18/18) |
| Confirmed admission to Workflow callback | 555.5 ms (12/18) | 399 ms (18/18) |
| Execution fetch to app entry, approximate | 250 ms (14/18) | 259 ms (16/18) |
| App entry to first model call | 364.5 ms (16/18) | 341 ms (16/18) |
| Rate admission, inside app setup | 138.5 ms (16/18) | 139 ms (16/18) |
| Context preparation, inside app setup | 101.5 ms (16/18) | 113.5 ms (16/18) |
| Provider initialization | 0 ms (17/18) | 0 ms (17/18) |
| Tracing initialization | 0 ms (17/18) | 0 ms (17/18) |
| Trace export, now retained separately | 352.5 ms (16/18) | 226.5 ms (18/18) |
| Generation complete to checkpoint | 81.5 ms (16/18) | 115 ms (17/18) |
| Checkpoint to commit fetch, approximate | 74.5 ms (18/18) | 81 ms (17/18) |
| Commit request | 33 ms (17/18) | 42.5 ms (18/18) |

The specific targeted wait fell from a median **555.5 ms (12 available control
samples) to 0 ms recorded (18 early samples)**. Control values ranged 224–1,131 ms.
Zero is at the platform logger's millisecond resolution, not proof of literally
zero CPU work or zero total startup. The later Workflow callback still arrived
after a median 399 ms in the early arm;
all 18 callbacks logged joining the existing producer. Other startup work
remains. These stage medians overlap and must not be added; cross-Worker wall
intervals are explicitly approximate.

Missing log markers are unknown, not zero. Four control execution-start markers
and one control publication marker were absent; six control admission/fetch
pairs were incomplete. All client completions remained visible. The API exports
were checked for truncation, decoded and deduplicated: 2,250 allowlisted records
from 13 bounded queries for the comparison and safety checks. This does not
establish that Cloudflare retained every original console event.

### Reliability, model work and limits

All 36 comparison requests returned exactly one canonical response, with zero
stream errors or fallbacks. Their 312 cloud observations include 92 model calls,
matching the response step counts on every turn. The control made 44 calls and
early made 48. In two Spanish directions pairs, the unchanged model chose
additional venue/directions lookups in the early arm. All failures and slower
turns remain included; these four calls were not duplicate producers. Sixteen
of eighteen pairs used the same tool sequence and model-call count.

All traces retain configuration fingerprint
`782f101d6bce988470a80b175de3bf3f91a9e671fe6f3d731cdca4013bac83ee`.
The full smoke/comparison/safety collection has 353 observations and 104 model
calls across 41 submitted turns. Every submitted attempt is observed. No paid
grader was added, and no independent prose-quality improvement is claimed.
Langfuse's older release label is not used as deployment proof; the actual
Worker versions and build commits above establish source identity.

The separate live reconnect check detached after a preview and resumed from
its cursor, publishing one final response. Live Stop returned HTTP 204 and
published no final response, retaining the expected “Response stopped” event.
The safety prompt was changed to already-verified generic discovery before
either safety request; its original source and amendment are retained.
Native browser/workerd checks additionally cover generation/commit restart,
stale-fence rejection, checkpoint reuse and exhausted recovery with exactly
three generations. A deployed runtime-reset fault injection was not performed.

Release gates passed: PR #25 has 924 Vitest tests and 938 Bun passes; PR #26 has
933 Vitest tests and 947 Bun passes. Each Bun gate has one existing homepage
skip. Svelte/Effect/TypeScript checks, production builds, ten canonical specs
and default/early browser/workerd checks pass. The first startup browser run
raced generated Paraglide files and failed; serialized retries pass and the
original output remains retained. An unnecessary /api/health probe returned
404 because that route is absent; the actual homepage smoke returned 200.

### Cleanup and recommendation

After both safety checks, the original default-configured delivery version was
restored immediately. Cloudflare's settings read still described the latest
uploaded campaign version, so a clean deployment of the same tested source
also removed the variable from that latest configuration. Both active-version
and latest settings now contain no experiment binding. Final versions, all at
100%, are:

- Telegram: `0e2adf2d-2dba-40d3-8982-058e31cd97cc`.
- MCP: `29074721-a999-4447-b23c-ef051743087d`.
- Public web: `43c959a0-3aec-4fb1-99bb-0a62d64cb777`.
- Delivery: `f18fee66-e6dc-49de-bfff-260f40b0a54e`.

Keep the released search/export corrections, existing thinking settings and
disabled directions shortcut. Earlier startup is a promising way to remove
about half a second of avoidable waiting. Before changing its default, run a
larger, properly counterbalanced or randomized cohort and a deployed restart
smoke; monitor actual duplicate generation, missing checkpoints, Stop/replay
and completion tails. This experiment completes the requested bounded live
comparison, not a broader rollout or independent answer-quality approval.

Private plan, raw responses, source hashes, unchanged-setting proof, complete
query exports, spans, analysis scripts, exploratory uncertainty, release gates,
original diagnostics, deployment/rollback and cleanup receipts are under
`results/releases/startup-controlled-20261018/`.

## Expanded deployed startup comparison and native restart checks (2026-10-18)

The follow-up uses the same released application source, model and thinking
configuration. The directions shortcut remains disabled. Only a finite server
allowlist selects the experimental startup requests; normal users retain the
normal path. Campaign delivery version is
`57b8c766-7f66-4e0e-8119-8130dcdd0d94`; public web remains
`43c959a0-3aec-4fb1-99bb-0a62d64cb777`.

The plan fixes 16 independent conversation pairs, three turns per arm (96
messages), before timing. Four seeded shuffled blocks each contain all four
combinations of English/Spanish and initial arm order. Order alternates on
subsequent turns. Two blocks run in each of two hourly quota windows, respecting
the unchanged 50-request limit. Each arm uses its own actual response history.
The prompts cover discovery, assessment of the first event, and directions.
This is HTTPS stream timing, not browser paint measurement or a controlled
cold-start-only test. Full protocol, source hashes and assignments are retained
under `results/releases/startup-expanded-20261018/`.

## Production startup enablement (2026-10-18 local time)

The owner authorized enabling earlier startup for all new production chats and
testing it before deciding to keep it. PR #27 merge
`c0f0c8d8cf644a529c354ef79ea5ecdc8d77103e` commits the delivery setting
`CHAT_EXPERIMENTAL_EARLY_GENERATION=after-admission` and updates the canonical
startup policy. Existing attempts keep their persisted policy. Runtime
implementation, model/thinking settings and directions shortcut behavior are
unchanged. The separate card fix remains outside this release.

Native production build `3d0ad849-ef52-4e47-a3b1-58dcaca09939` succeeds at
00:44:23 UTC. Both active and latest delivery configuration show the startup
setting, without a finite comparison allowlist or model/directions overrides.
Delivery version is `b3884da7-a50d-423e-bf6f-508a9d4109d5`; the normal-startup
rollback version is `8bd05f69-3512-4f17-a3df-c84c898d4347`.

Full gates pass: 933 Vitest tests, 947 Bun passes with one existing skip,
Svelte/Effect/TypeScript checks, ten canonical specs and delivery bundling.
The early browser/workerd suite passes UI/replay, Stop, native generation and
commit restarts, checkpoint reuse and exhausted retries. Its first harness run
lacked dummy Supabase construction values; a fixture-only retry passes without
real credentials. This is a harness setup failure, retained separately.

Two initial production smokes complete with one agent run and one final each.
Both record zero post-admission dispatch wait at logger resolution and the
delayed callback joining the original producer. All four model calls retain
the baseline configuration fingerprint. Two invalid-capability stream reads
return 403 without event data. The first trace query precedes ingestion and
returns zero observations; the later query observes both attempts and all 14
observations. These initial checks are followed by the broader acceptance below.

**Decision: keep earlier startup enabled globally.** Post-enable checks finish
at 01:04 UTC on October 19 (October 18 locally). All 30 ordinary messages
pass: the two smokes, 24 turns across eight independent bilingual conversations,
and four simultaneous independent requests. Each has one observed agent run,
one execution start and one final streamed answer, without stream errors or
fallback. All 30 admission/execution pairs record zero post-admission wait at
logger resolution; 29 later callbacks are observed joining an existing run.
Final-publication log markers are available for 28/30; all 30 client streams
contain exactly one final. Missing markers are not counted as extra proof.

Two reconnect checks resume the original attempt and publish one answer each.
Two Stops return 204 and publish no final, with only the expected stopped
message. Both planned native deployed resets succeed on the first attempt,
verified by the native abort reason, eight deployed log witnesses, original
assistant identity, higher recovery fence and one live/replayed final each.
Generation interruption correctly needs a replacement fenced generation;
checkpoint interruption reuses the saved answer with one original agent run
and zero model calls starting after the reset. Neither checkpoint reserve is
used. All 36 submitted attempts appear in 276 observations; their 79 model
calls retain the baseline configuration fingerprint. Twelve complete ordinary/
safety log exports retain 2,185 relevant records, plus the native witnesses.

These varied post-enable requests are reliability acceptance, not another
controlled speed comparison. Across the 30 ordinary messages, median first
prose is 5.471 s and completion 7.567 s; observed completion p95 is 8.916 s,
maximum 11.084 s. The eight conversation-opening messages have median first
prose/completion 4.501/7.012 s; turn two is 5.597/6.873 s and turn three
6.429/7.567 s (eight each). Four concurrent requests complete in 5.703–8.389 s.
Different requests and live model/catalog variation prevent comparing these
totals causally with earlier runs. The previous controlled comparison remains
the benefit evidence: about 0.4 s directly measured waiting removed, with
roughly 0.7 s better observed median completion in that sample.

No independent prose-quality equivalence is claimed. One Spanish follow-up
first uses an invalid unqualified event reference and then searches again,
returning another recommendation rather than explaining the requested listing;
its third model call and latency remain included. A separate Spanish directions
answer honestly reports missing address data and returns venue details. These
are retained diagnostics, not attributed to startup scheduling. The known
repeated-card issue and independently reviewed prose quality remain separate
work; the unshipped card fix is preserved locally.

The unchanged 50/hour quota starts at 0 and ends at 34 in the second window;
the two smokes used the previous window's final two slots. No quota was changed
or bypassed. The temporary operator Worker is deleted and its local secret
removed. Its deletion succeeded; the combined verification call then threw the
expected 10007 absent-Worker error before returning JSON. Independent Worker
listing and a separate settings read confirm absence. Final live verification
at 01:05:04 UTC confirms the global setting in both active and latest delivery
configuration, no finite allowlist, and no thinking/directions overrides in
any of the four Workers. Thinking remains unchanged; the directions shortcut
remains disabled. Active versions:

- Web: `a5f3b7e9-9bcd-43ec-8817-0f3874bb10e6`.
- Delivery: `b3884da7-a50d-423e-bf6f-508a9d4109d5`.
- Telegram: `24615a86-e978-42b7-98b5-b6aab097badf`.
- MCP: `366b2a1d-f603-4bb1-b092-628d47c5af09`.

Private source identity, committed setting, gates, initial diagnostics, seeded
request IDs, actual streamed answers, logs, traces and production receipts:
`results/releases/startup-production-20261018/`.

### Native deployed restart evidence

A temporary authenticated operator Worker invoked the application's existing
binding-only recovery administrator for exact allowlisted test attempts. The
operator used the platform's native Durable Object abort; no ordinary-user
restart endpoint or application runtime change was added. The temporary Worker
was deleted after the checks, and its local bearer secret removed.

| Startup / reset point | Verified native reset | Agent generations / model calls | Recovery result | Approximate reset to final response |
| --- | --- | --- | --- | ---: |
| Normal, before checkpoint | Yes | 2 / 4, including interrupted work | One final answer, same assistant identity, replay once | 5.016 s |
| Earlier, before checkpoint | Yes | 2 / 4, including interrupted work | One final answer, same assistant identity, replay once | 4.772 s |
| Earlier, after checkpoint | Yes | 1 / 2 | Saved answer reused without another model generation; replay once | 1.545 s |
| Normal, after checkpoint | Unverified in four attempts | 1 / 2 each | Original answers complete; fault window missed or operator transport failed | Unknown |

All three verified cases have the exact native reset reason, matching deployed
native logs, recovery fence 3, one canonical live and replay response, original
assistant identity and no stream error. Before checkpoint, rerunning generation
under a new fence is expected recovery work. After checkpoint, the one original
agent root and two original model calls confirm reuse. These are individual
fault-injection examples, not a recovery percentile or an exhaustive crash test.

One original control-checkpoint receipt marked an RPC exception as success.
Audit rejected that flag: a completed object can also reject an interrupt, and
the normal persistence transition already advances its fence from 1 to 2.
Require the exact native reset reason and a matching native log to claim an
actual reset. Original raw receipts remain unchanged. Four narrow-window
attempts are retained as unverified, not counted as successes or application
response failures. The temporary operator's four focused tests pass; all seven
submitted test attempts appear in 63 retained observations with 18 model calls
and the unchanged configuration fingerprint.

### Expanded timing results

The expanded run completed 2026-10-19T00:05:40.736Z: 96 messages, 16 independent conversation pairs, 48 matched turn comparisons, four complete randomized blocks and two quota windows. Each language and each initial arm order has equal representation. The earlier 36-message cohort remains separate.

| Turn type (16 per method) | Normal first prose | Earlier first prose | Normal completion | Earlier completion |
| --- | ---: | ---: | ---: | ---: |
| Discovery | 4.625 s | 4.045 s | 7.275 s | 6.447 s |
| Assessment | 6.088 s | 5.437 s | 7.063 s | 6.503 s |
| Directions | 5.798 s | 5.088 s | 6.649 s | 5.957 s |

| All turns (48 per method) | Normal median | Earlier median | Normal sample p95 | Earlier sample p95 |
| --- | ---: | ---: | ---: | ---: |
| First artifact | 4.583 s | 4.112 s | 6.756 s | 5.100 s |
| First visible artifact or prose | 4.583 s | 4.112 s | 6.756 s | 5.100 s |
| First prose | 5.777 s | 4.989 s | 8.179 s | 6.038 s |
| Completion | 6.958 s | 6.239 s | 10.846 s | 8.694 s |

Maximum completion was 12.012 s normal and 9.767 s earlier. Sample p95 is descriptive, not a production service-level estimate. First visible output includes the known unwanted repeated card on assessments; first prose is the more relevant measure for that turn. Timing does not establish prose grounding or usefulness.

| Paired metric | Mean earlier minus normal | Exploratory 95% cluster interval |
| --- | ---: | --- |
| firstArtifactMs | -0.740 s | -1.029 to -0.479 s |
| firstProseMs | -0.756 s | -1.040 to -0.498 s |
| firstOutputMs | -0.730 s | -1.034 to -0.469 s |
| finalMs | -0.756 s | -1.124 to -0.404 s |

Intervals use 10,000 seeded resamples of 16 conversation pairs, keeping each pair's three turns together. Negative values favor earlier startup. This is an exploratory interval for mean paired differences, not a confidence interval for medians. Live catalog, model output, shared infrastructure, cache and only two time windows limit generalization. Slower turns and source/tool differences remain included.

| Stage | Normal median (available / 48) | Earlier median (available / 48) |
| --- | ---: | ---: |
| Workflow admission | 0.641 s (47/48) | 0.583 s (47/48) |
| Durable input to execution fetch | 1.090 s (47/48) | 0.583 s (47/48) |
| Confirmed admission to execution fetch | 0.396 s (46/48) | 0.000 s (47/48) |
| Confirmed admission to Workflow callback | 0.396 s (46/48) | 0.499 s (46/48) |
| Confirmed admission to early callback | Not used | 0.000 s (47/48) |
| Execution fetch to app entry, approximate | 0.245 s (47/48) | 0.258 s (44/48) |
| App entry to first model call | 0.379 s (47/48) | 0.373 s (45/48) |
| Rate admission, inside setup | 0.145 s (46/48) | 0.146 s (43/48) |
| Context preparation, inside setup | 0.116 s (47/48) | 0.109 s (47/48) |
| Provider initialization | 0.000 s (47/48) | 0.000 s (48/48) |
| Tracing initialization | 0.000 s (47/48) | 0.000 s (48/48) |
| Separately retained trace export | 0.208 s (46/48) | 0.216 s (48/48) |
| Generation complete to checkpoint | 0.090 s (45/48) | 0.120 s (46/48) |
| Checkpoint to commit fetch, approximate | 0.085 s (42/48) | 0.080 s (46/48) |
| Commit request | 0.044 s (43/48) | 0.043 s (47/48) |

Cross-Worker wall intervals are approximate. Missing markers are unknown; zero is at the logger's millisecond resolution. Overlapping stage medians must not be summed. Provider and tracing initialization measurements in this cohort do not establish cold-start performance.

| Stratum | Normal first prose | Earlier first prose | Normal completion | Earlier completion |
| --- | ---: | ---: | ---: | ---: |
| locale=es (24 per method) | 5.649 s | 5.021 s | 6.736 s | 6.301 s |
| locale=en (24 per method) | 5.891 s | 4.988 s | 7.013 s | 6.176 s |
| window=0 (24 per method) | 5.540 s | 4.958 s | 6.700 s | 6.168 s |
| window=1 (24 per method) | 5.910 s | 5.045 s | 7.063 s | 6.431 s |
| initialEarlyFirst=false (24 per method) | 5.894 s | 5.058 s | 6.958 s | 6.526 s |
| initialEarlyFirst=true (24 per method) | 5.058 s | 4.941 s | 6.880 s | 5.974 s |

0 stream/request errors, 0 fallbacks. All 96 responses have one canonical final answer: true. One observed agent root per turn: true. Model calls total 193, with 0 mismatches against response-step counts. Matching paired tool sequences: 47/48.

675 comparison observations; 738 total observations including separate restart attempts. 5837 deduplicated allowlisted comparison log records. 5 turns lack a complete execution/publication marker pair, with 0 duplicate execution markers and 0 duplicate publication markers. Missing logs do not override observed successful client completion.

Structural discovery checks: 32/32. Assessments without repeated cards: 0/32. The repeated-card suppression is a separate local implementation, absent from this deployed baseline in both arms. These findings are not a newly introduced startup regression or a prose-quality acceptance. Unblinded source spot-review notes and unsupported inferences remain retained; no paid grader or independent human quality approval is claimed.

### Attribution, quality limits and recommendation

Earlier startup reduced median completion by 719 ms (about 10%) and median
first prose by 788 ms (about 14%) in this workload. First-message completion
was 7.275/6.447 s (16 per method); follow-up completion was 6.948/6.239 s
(32 per method). Median completion was lower with earlier startup in both
languages, both hourly batches, both initial-order groups and all four blocks.
The 16-cluster exploratory interval favors earlier startup, unlike the earlier
six-pair run. These are separate cohorts and are not pooled.

The directly measured scheduling improvement is **396 ms to 0 ms recorded**
after confirmed admission (46/48 normal and 47/48 earlier samples). Do not
attribute the entire end-to-end difference to that change. The unchanged model
made different decisions in three comparisons: two normal discovery turns kept
semantic queries containing “eventos variados” (2.401 and 2.289 s search reads),
while their earlier counterparts used filter-only retrieval. One normal
assessment first used an unknown event reference, then corrected it and made
an extra details read. That turn has one agent producer and three model steps,
not duplicate producers. The normal arm has 97 model calls and earlier has 96;
all original differences, slower turns and failures of individual tool reads
remain included in the latency and uncertainty calculations.

| Observed work | Normal | Earlier |
| --- | ---: | ---: |
| Total model time, median per message (48 each) | 3.603 s | 3.355 s |
| Search read, median (16 each) | 0.595 s | 0.574 s |
| Event-details reads, median per assessment (16 each) | 0.124 s | 0.119 s |
| Directions read, median (16 each) | 0.125 s | 0.120 s |
| Reported input tokens, summed | 370,602 | 365,972 |
| Reported cached input tokens, included in input | 245,624 | 242,168 |
| Reported output tokens, summed | 18,865 | 18,497 |

All 193 model observations retain configuration fingerprint
`782f101d6bce988470a80b175de3bf3f91a9e671fe6f3d731cdca4013bac83ee`
and selected model `deepseek-flash`. Token counts are reported usage, not a
provider invoice or cost per independently reviewed success. Langfuse's older
release label is not used as source proof. Actual Worker versions, the clean
merged tree and source hashes establish release identity.

All 32 discovery responses returned three events and all 32 directions turns
returned a directions artifact. All 32 assessments still repeat the event
card: the original issue's fix remains local, outside this deployed comparison.
Engineering source spot-review also retains unsupported stylistic/atmosphere
inferences in both methods, an outside-source film-genre claim in a normal
answer, and an earlier answer that relabels the listed start as a door-opening
time. This review is unblinded and diagnostic. Neither unchanged settings nor
the structural checks establish independent prose-quality equivalence.

**Recommendation:** make earlier startup the next gradual-release candidate,
with real-traffic completion tails and observed producer counts monitored.
The combined latency, balanced order and native recovery evidence support
that next step; this test does not enable it for ordinary users. Plan for roughly
0.4 seconds of directly measured avoidable waiting removed, rather than
promising the full 0.7–0.8 second observed difference for every request. Keep
thinking unchanged and the directions shortcut disabled. Release the separate
card fix independently, and use the retained unsupported-answer examples in
the existing quality work before changing model/completion behavior. Model
time remains the largest measured component; this run does not justify
skipping reasoning or the normal tool loop.

### Expanded-run cleanup and verification

At 00:06:42 UTC, the prior normal-startup version was restored, then the
same clean tested delivery source was deployed with the normal configuration to remove the
campaign from the latest uploaded settings as well. Final verification at
00:07:08 UTC confirms no startup/thinking/directions experiment override in
either active-version or latest settings for all four Workers. Final versions:

- Public web: `43c959a0-3aec-4fb1-99bb-0a62d64cb777` (unchanged).
- Delivery: `8bd05f69-3512-4f17-a3df-c84c898d4347` (normal startup).
- Telegram: `0e2adf2d-2dba-40d3-8982-058e31cd97cc` (unchanged).
- MCP: `29074721-a999-4447-b23c-ef051743087d` (unchanged).

The temporary operator Worker is absent and its local bearer secret removed.
Both comparison windows started at 0/50 and ended at 48/50; no limit was
changed or bypassed. Four operator tests and ten canonical specs pass.
Application runtime code did not change in this checkpoint, so the prior full
release gates remain applicable. An initially unavailable global OpenSpec
command was replaced with the pinned Bun CLI; original diagnostics remain
retained. The clean deployment worktree was archived after verification. No new model-quality grader, broad startup rollout or model setting
change is included.

Private protocol, seeded assignments, pre-run hashes, actual histories and
response milestones, 32 checked untruncated comparison log exports plus three
restart exports, all 738 observations across 103 submitted attempts, raw failed
fault-injection diagnostics, strict native reset audit, source spot-reviews,
analysis, uncertainty, configuration restoration and final evidence hashes are
under `results/releases/startup-expanded-20261018/`.

## Main consolidation (2026-10-18 local time)

At the owners request, the remaining repeated-card fix, startup profiler,
comparison adapters, regression tests and complete reports are consolidated
with current main. The newer homepage and artwork work is preserved. Earlier
sections describe the code deployed at each historical measurement; statements
that the card fix was still local apply to those snapshots. This checkpoint
includes that fix for main, retaining progressive/final text-only follow-ups,
successful-read provenance and later ordinal references. Fresh/home details,
searches, saved lists and save/unsave guidance keep their cards.

Thinking, low-effort and direct-directions candidates remain explicit evaluation
injections. Production keeps enabled thinking under its existing adaptive
alias, the directions shortcut stays disabled, and after-admission startup
stays globally enabled. Consolidating the evaluation code does not promote
a candidate or establish independently reviewed prose quality.

The integrated release gate passes 980 Bun tests with one existing skip,
958 Vitest tests, Svelte/Effect/TypeScript checks and ten canonical specs.
The unchanged artwork spec has one requirement-length advisory. The initial
Bun run accidentally discovered loose safety-backup test copies; they were
replaced by a byte-verified archive and the full retry passes. This was a
backup-layout failure, with no application patch. Production build, final
merge/deployment identities and cleanup verification are separate receipts
under `results/releases/main-cleanup-20261018/`. Private responses and evidence
remain ignored; no paid comparison is rerun for repository cleanup.

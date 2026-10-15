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

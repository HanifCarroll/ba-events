# AI performance and spending

Use the existing Langfuse projects, eval receipts and scan ledger. These are
provisional operating targets for the current small deployment; they are not
measured production service levels or a promise to the traveler.

| Measure | BA Eventos | Casamo |
| --- | --- | --- |
| First useful result, p95 | Within 5 seconds of starting a turn | First acquired candidate/progress within 60 seconds of scan admission |
| Complete response, p95 | Within 15 seconds | Saved qualified-choice report within 15 minutes of admission |
| Existing hard execution boundary | 60 seconds per turn; 20 seconds per model step | 60 minutes per admitted scan; queue wait is separate |
| Cost per independently reviewed success | Unmeasured; monetary target pending budget choice | Unmeasured; monetary target pending budget choice |

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

Casamo's shared structured client defaults to 4,096 output tokens. Its locally
implemented audit input guard rejects more than 64 KiB of complete text before
I/O and rejects reported input beyond 32,768 tokens after the response. That
context-budget change still requires its separate release. The accepted scan
manifest owns action attempts, deadlines and durable resource permits. Keep those
existing controls; changes to their numerical ceilings must use a new captured
policy revision. Permits count actions and can cover multiple photo calls, so
they must not be reported as an exact number of simultaneous HTTP requests.

Per-call output limits and concurrency permits are not a monthly dollar cap.
Choose the account budget, then use the provider balance/billing controls and
existing usage views before considering a new application spending ledger.
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
report an estimate as an invoice. BA’s trace exporter now maps reported DeepSeek Flash counters to the published peak/off-peak token-rate estimate, with explicit estimate/rate/time-basis metadata and unknown values preserved. This excludes other providers and infrastructure. New deployed cost visibility, Casamo’s corresponding mapping and fallback/usage coverage remain under section 8.

For the next model/configuration comparison, reuse the frozen conversation
corpus and existing repeated-trial adapter. Record selected and returned model,
prompt/configuration/corpus hashes, trial count, latency, usage, failures and
reviewed quality together. Change one setting at a time. The installed SDK maps
configured `adaptive` thinking to wire `enabled`; record the wire mode rather
than comparing it as a distinct provider capability. Do not select a cheaper
configuration based on latency alone or run a larger benchmark before the
pending quality labels can support the decision.

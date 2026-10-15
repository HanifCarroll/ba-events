# Langfuse

BA Eventos has its own project in the **HC Studio** organization on the US
Langfuse Cloud instance. Casamo uses a separate project and separate credentials.

## Configuration

Set these server-only values in the ignored `.env` locally and as secrets on the
`baeventos` Cloudflare Worker for production:

```dotenv
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://us.cloud.langfuse.com
LANGFUSE_TRACING_ENVIRONMENT=production
LANGFUSE_RELEASE=<application commit or release>
```

Production keys belong to the application Worker, where web and Telegram
concierge execution runs. They are not needed on the chat-delivery Worker.
No keys are exposed to the browser or committed. Ordinary unit tests need no
Langfuse or model credentials. Missing keys or `LANGFUSE_TRACING_ENABLED=false`
disable production tracing. Export failures do not retry or fail a chat turn.

The integration uses AI SDK 7's per-call telemetry integration and a minimal
OpenTelemetry provider with AsyncLocalStorage, supported by Workers'
`nodejs_compat`, with the v4 ingestion header set explicitly. It records concierge/model/tool spans, model usage and timings,
request IDs and conversation sessions. Inputs and outputs include chat text and
model-facing tool facts, including saved-list results; authentication tokens,
delivery capabilities, credentials and raw user-tool context are not attached.
The export boundary redacts a copy of all span attributes, error events/status
and links, including raw AI/GenAI fields. It masks common emails, international
phone numbers, explicit credential fields and token patterns, and strips URL
queries/fragments. Useful chat/tool facts, usage and correlation IDs remain;
model inputs and application responses are not changed. If redaction fails, the
span is omitted. Pattern redaction does not anonymize names, addresses or every
possible secret, and does not rewrite historical traces. Casamo audit tracing
retains its separate metadata-only policy.
Keep project access and retention appropriate for this data. A turn's bounded
export is explicitly flushed after both streaming and non-streaming generation,
including errors, rather than relying on a Worker staying awake.

Each configured production model run also propagates `promptVersion` and
`configurationId`. The prompt revision is `concierge-prompt-v1`; bump it when
instruction templates or tool descriptions change. The configuration ID is a
SHA-256 fingerprint of the selected provider/model, canonical contract, supplied
tool names, limits, retries and thinking options. It excludes messages,
credentials and per-user context. Keep the application release alongside these
identifiers; the fingerprint describes configured options rather than replacing
code or SDK version tracking. Historical traces are not backfilled.

Tracing uses the installed OpenTelemetry provider's `parentbased_always_on`
default: new root traces are selected at 100%, and child spans inherit the
parent's sampled flag. The active production web/Telegram Workers have no
`OTEL_TRACES_SAMPLER` or `OTEL_TRACES_SAMPLER_ARG` binding override (read on
2026-10-14). Langfuse exports its supported Langfuse/GenAI/LLM spans after the
redaction boundary. Selection is not delivery: disabled/missing credentials,
redaction failure, export failure or Worker lifetime can leave observations
missing. No probabilistic sampling or delivery guarantee is inferred from a
healthy example trace.

## Evaluation

```sh
bun run eval:concierge                         # existing local report
bun run eval:concierge:langfuse                 # Langfuse experiment, all cases
bun run eval:concierge:langfuse scope-capital-of-france # one exact case ID
```

Both live commands call the shared production turn preparation and the real
model/tools/database. They reuse the same version-controlled cases and graders.
They are opt-in and never run as part of the ordinary unit suites. Model calls
incur the provider's usual cost. Langfuse's experiment runner handles concurrent
execution, scores, traces and comparisons; task/evaluator failures and failed
case scores produce a nonzero process exit.

`EVAL_DATE_IN_BA` optionally pins the date supplied to the planner. By default
the current Buenos Aires date is recorded in experiment metadata. Retrieval
still reads a changing live database: these are integration checks, not a frozen
retrieval benchmark. For strict comparisons use the same corpus snapshot as
well as matching cases, application release and evaluator version.

The thin `runConcierge` adapter accepts prior response hints, recent messages,
last search, pins, home event IDs and an evaluation session. Prior cards are
rehydrated through the same authoritative lookup as production. Keep domain
checks and fixtures in the repository; Langfuse does not replace deterministic
unit tests or define correctness. All cases gate canonical card grounding,
read-only behavior and fallback failures. Card provenance does not by itself
prove that every fact in model prose is grounded.

Production failures can be added as cases here and run against the actual
application before comparing experiments in Langfuse. Keep live model evals in
an explicit, credentialed CI job if adding CI automation; the default unit job
must remain offline.

For sequential conversations with controlled data, use
`bun run eval:concierge:multi --trials 3 --langfuse`. This runs the real model
against a fixed synthetic corpus without database or reranker calls, carries
actual prior outputs into follow-ups, and scores independent conversation
trials. See the [evaluation README](../evals/concierge/README.md) for scope,
report metadata and pass criteria. It complements the live-database integration
suite and does not establish production retrieval quality.

## Operational views

Use the existing [dashboard catalog](https://us.cloud.langfuse.com/project/cmv6t26o70225ad0jytemjzdp/dashboards)
for Home, Agent, Latency, Cost and Usage views. Avoid duplicating those reports.
The saved [Production model errors widget](https://us.cloud.langfuse.com/project/cmv6t26o70225ad0jytemjzdp/widgets/cmv7mkh1g06vvad0j456vbf0v)
counts only production GENERATION observations with ERROR status. Its filters
were verified after saving. Check recorded traffic separately: zero errors or
an empty chart cannot prove telemetry coverage or successful customer outcomes.

The prepared alert uses count > 0 over one hour, missing data as NO_DATA, and
renotification off. It is not saved: Langfuse requires at least one notification
automation, and an existing destination has not been selected. No Slack, webhook
receiver or GitHub Actions integration was created. Hobby allows two alerts per
organization, so reserve one per project.

Production model timing and usage were inspected for six observed BA generations on October 14. Their dollar-cost fields were empty, and none of the 190 available model definitions matched DeepSeek. The export boundary now estimates DeepSeek Flash token costs from valid reported total input/cache/output counters using the [published peak/off-peak rates](https://api-docs.deepseek.com/quick_start/pricing/). Raw OTLP cost exports include an explicit `total` for aggregate views; component-only records produced an observed zero cost aggregate and remain a retained diagnostic. Rates are versioned `deepseek-flash-2026-09-10`; cached tokens are subtracted from total input before charging uncached input. Reasoning is already included in provider output totals and is not charged again. The estimate uses model-span start time; calls whose endpoints have different price periods are left unpriced. Missing/inconsistent counters, other models and previously supplied costs are preserved. Estimates exclude embeddings, reranking, acquisition, proxies and infrastructure and do not certify an invoice or cost per independently reviewed success. Update the small rate table when provider prices change; no pricing service or spending ledger was added.

Deployment, fresh production cost visibility and fallback measurement remain separate checkpoints. Curated cost views do not prove total provider spend.
Experiments retain diagnostic scores separately from human-calibrated quality.

References: [Custom dashboards](https://langfuse.com/docs/metrics/features/custom-dashboards),
[alerts and plan limits](https://langfuse.com/docs/observability/features/alerts).

References: [AI SDK 7 integration](https://langfuse.com/integrations/frameworks/vercel-ai-sdk),
[experiment runner](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk).

## Operational measurement sources

Use production GENERATION observations in Langfuse for model-span count, latency,
input/output/cache usage and reported-response token estimates. Do not sum SDK
agent roots with their child generations. The v2 Metrics API reports latency in
milliseconds. The same production/time filters apply to model-error views.

Canonical fallback is a different outcome from a failed model request. BA’s
existing guest_request_lifecycle table records completed_with_fallback and the
closed fallback reason. Divide that status by completed + completed_with_fallback
for the recorded guest-web completion denominator; retain started and errored
separately. Writes are best effort, so missing records, signed-in web and Telegram
are outside that denominator. Keep synthetic setup checks separate from user
satisfaction and graded quality. No second ledger or runtime collector is needed.

At the 2026-10-14 21:09 UTC read, the production Metrics API contains 10 BA
generations (40,190 tokens; mean model-span latency 2,661 ms, p95 4,703 ms). Only
the two responses after the aggregate-price correction have totals; older
unpriced/component-only observations remain unknown. The guest ledger contains
four recorded completions and no fallback, all within the setup-check period.
This is measurement coverage, not a customer-health baseline.

Casamo’s same-day production read contains 11 generations, 26,113 tokens,
mean model-span latency 2,384 ms and p95 3,413 ms. Eight responses in the new
production canary have explicit cost totals. Model latency is distinct from
whole-scan latency, provider acquisition completeness and independently graded
decision quality. The existing model meter retains response metadata; an empty
legacy provider-attempt table does not establish zero acquisition or fallback.

References: [Metrics API](https://langfuse.com/docs/metrics/features/metrics-api).

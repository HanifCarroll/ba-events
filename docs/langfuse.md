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
Keep project access and retention appropriate for this data. A turn's bounded
export is explicitly flushed after both streaming and non-streaming generation,
including errors, rather than relying on a Worker staying awake.

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

References: [AI SDK 7 integration](https://langfuse.com/integrations/frameworks/vercel-ai-sdk),
[experiment runner](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk).

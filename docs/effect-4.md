# Effect 4 architecture and async census

BA Eventos uses the exact `effect@4.1.4` package installed in
`node_modules/effect`. Its `AGENTS.md`, `ai-docs/`, and `src/` are the
version-matched source of truth. We do not vendor or duplicate an Effect
subtree. `@effect/language-service@0.87.5` runs after the Svelte plugin and is
part of `bun run check`.

## Boundary policy

Effect is used where the application owns a side-effecting program or an
untrusted JSON boundary. Pure code remains ordinary TypeScript: transforms,
normalizers, date and location calculations, ranking, formatting, scraper
HTML/JSON-LD parsing, and Svelte 5 runes/state. Effectful application-owned
orchestration is represented by `Effect.gen` programs, with typed expected
failures and explicit sequencing/concurrency. Existing dependency injection
stays in place.

XState v6 owns event-driven feature lifecycles described in
[the state-machine inventory](state-machines.md). Pure XState transitions can
govern admission and persisted-phase changes inside an Effect or platform
operation. Component actors own cancellable UI work; they do not add an Effect
runtime. Cloudflare storage/alarms, Workflow checkpoints/retries, database
transactions and provider receipts remain the durability authority. XState
snapshots are not a second server-side persistence format.

The Telegram turn graph is the one runtime-local service exception: a
per-invocation `TelegramTurnService` `Context.Service`/`Layer` normalizes its
injected Promise and Effect implementations before the graph runs. It is
provided at the turn boundary and does not create a process-global runtime.

The canonical application exports are the `*Effect` programs. A small number
of Promise functions remain as compatibility adapters for existing tests and
non-Effect callers; those adapters call `Effect.runPromise` and are listed
below. Framework callbacks and direct SDK/platform calls are also Promise
boundaries. No application-wide Effect runtime, Layer graph, or service
container is introduced; the runtime-local Telegram service above is the
deliberate exception. Effect schedules, Effect HTTP server/client, Atom
adapters, and `effect/unstable/*` modules remain out of scope. The
unstable-module allowlist is empty.

Repository-owned request/response JSON is decoded once with Effect Schema.
Schemas preserve the old nullable, default, bounding, status-code, and error
contracts. Strict legacy shapes opt into `{ onExcessProperty: "error" }`;
ordinary Struct schemas retain Effect's default excess-field stripping.
AI SDK/provider and MCP SDK schemas remain their SDK-owned Zod schemas because
those SDKs consume and register them. D1, Dexie, Cloudflare Playwright,
AI streaming/providers, PostHog, Web Crypto, generated Paraglide code, and
browser automation remain direct SDK/platform boundaries.

## Connected application graphs

Instagram intake adds canonical `*Effect` programs in `src/features/import/intake/{collection,repository,service}.ts`. Collection HTTP/image downloads and the injected Apify client are direct SDK/network leaves; the operator CLI in `scripts/instagram-intake.ts` is a script runtime root. Candidate decoding uses Effect Schema, while planning and matching remain pure TypeScript. No global Effect runtime or additional service layer is introduced.

These are the canonical Effect programs and their expected failures. The
Promise adapters in the same files are compatibility surfaces, not the
application graph.

| Graph | Effect-native owners | Direct leaves and preserved behavior |
| --- | --- | --- |
| Auth and chat data | `src/features/auth/api/{session,server}.server.ts`; `src/features/chat/api/{conversations,messages,external-conversations,turns,user-tools,guest-debug}.server.ts` | D1 repositories, SvelteKit request/session APIs, redirects, and remote functions. Auth errors and nullable shapes remain unchanged. |
| Chat/AI turn | `src/features/chat/api/agent/{follow-up,orchestrate,persist,shared-turn.server}.ts` and `src/routes/api/chat/+server.ts` | AI SDK generation/tool callbacks, streaming response construction, and the request/stream lifecycle. Planner partial-read fallback, persistence fail-open behavior, turn claims, and terminal writes remain unchanged. |
| Event reads | `src/features/events/api/{crud,detail}.server.ts` | Existing event D1 reads and SvelteKit page loads. Pure event shaping remains TypeScript. |
| Telegram/Worker | `src/features/telegram/{turn,delivery.server,webhook.server,health,retention,client}.ts`; `src/telegram-worker/index.ts` | Bot API Promise calls, Worker `fetch`/`scheduled`, DO storage/alarm/retry/ack, `waitUntil`, and envelope key semantics remain platform-owned. `retry_after`, retry caps, and acknowledgement ordering are unchanged. |
| Import coordinators | `src/features/import/core/{ba-tourism,luma,meetup}.ts` | Browser scraping, source HTTP clients, AI categorization/embeddings, and catalog writes are explicit leaves. Source transforms, filtering, venue IDs, persisted shapes, progressive batches, and item-level skip behavior remain unchanged. |
| Import enrichment | `src/features/import/core/{event-enrichment,venue-settlement,venue-review,nominatim}.ts`; `src/features/import/api/duplicate-detection.ts`; `src/features/import/scrapers/venue-matcher.ts` | Vendor enrichment adapters, Nominatim's native timeout and one retry, D1 venue/event writes, and review workflows. Partial failure and fail-open/fail-closed behavior are preserved. |
| Scheduled jobs | `src/jobs-worker/{index,sources,daily-scrape,enrichment}.ts` | Each Workflow `step.do` callback is the runtime root and calls `Effect.runPromise`. The Workflow owns schedules, step retries, timeouts, and checkpoints. |

The import coordinators retain named legacy Promise adapters only to avoid
breaking existing callers: `processBATourismImport`,
`processLumaImport`, and `processMeetupImport`. The jobs Worker calls the
corresponding `*ImportEffect` program directly. The same rule applies to
repository helpers such as `listConversations`, `addMessage`, venue
settlement, duplicate detection, and Nominatim: canonical `*Effect` exports
are used by migrated callers; Promise exports are compatibility edges.

## Async-bearing file census

The census includes tests and generated declarations so an async-bearing file
cannot be mistaken for an application graph. The authoritative reproducible
inventory command is:

```bash
rg -l --glob '*.ts' --glob '*.tsx' --glob '*.svelte' '\basync\b|Promise<' src scripts evals | sort
```

At the time of this change it returned 215 files. The following groups cover
the complete result and classify each group; test files are explicitly
included where they exercise a runtime boundary.

### `src/` application and framework files

- **Auth:** `src/features/auth/api/auth.remote.ts`, `client.ts`,
  `rate-limit.server.ts`, `server.server.ts`, `session.server.ts`, and
  `src/features/auth/hooks/profile-mutations.svelte.ts`. Server auth programs
  are Effect-native; remote commands, browser auth client calls, and Svelte
  mutation callbacks are framework/SDK roots or leaves.
- **Chat:** `src/features/chat/api/agent/{follow-up,orchestrate,persist,shared-turn.server}.ts`,
  `generate-title.server.ts`, `guest-debug.server.ts`,
  `conversations.server.test.ts`, `external-conversations.server.test.ts`,
  `guest-debug.test.ts`, `follow-up.test.ts`, `orchestrate.test.ts`,
  `shared-turn.server.test.ts`, `chat-stream.test.ts`, the tool files under
  `src/features/chat/api/tools/`, `conversations.remote.ts`,
  `messages.remote.ts`, `generate-title.remote.ts`,
  `src/features/chat/lib/{persistence-outbox,saved,speech-recognition}.ts`,
  `src/features/chat/lib/persistence-outbox.test.ts`,
  `src/features/chat/state/chat.svelte.ts`, and the Svelte components under
  `src/features/chat/components/`. Server call graphs are Effect-native;
  AI SDK tool/stream callbacks, fetch-based outbox persistence, speech APIs,
  and Svelte callbacks are direct SDK/framework boundaries.
- **Events:** `src/features/events/lib/description-presentation.server.ts`
  and its test, `render-markdown.ts`, and event Svelte components
  (`EventCard.svelte`, `SaveEventButton.svelte`). Description generation is a
  provider leaf called by the import Effect graph; rendering and runes are
  pure/client code.
- **Import core:** `src/features/import/api/duplicate-detection.ts`,
  `core/{ba-tourism,event-enrichment,luma,meetup,nominatim,venue-review,
  venue-settlement}.ts`, `core/event-enrichment.test.ts` and
  `scrapers/meetup/detail.test.ts` where
  present, and `scrapers/venue-matcher.ts`. Canonical coordinators and
  repository/venue programs are Effect-native; direct source clients,
  Cloudflare Playwright, and test doubles are leaves.
- **Import adapters/scrapers:** `src/features/import/adapters/` enrichment
  adapters; `scrapers/ai-categorizer.ts`; source `api.ts`, `client.ts`,
  `detail.ts`, `enrichment.ts`, `description-enrichment.ts`,
  `venue-enrichment.ts`, and browser scrapers under
  `scrapers/{ba-tourism,luma,meetup}`; plus focused tests.
  These are plain transforms or direct source/AI/browser SDK adapters. Their
  Promise APIs are deliberate leaves called by the core Effect programs.
- **Telegram:** `src/features/telegram/client.ts`, `delivery.server.ts`,
  `health.ts`, `retention.ts`, `turn.ts`, `update.ts`, `webhook.server.ts`,
  and their focused tests. The production graph is Effect-native; Bot API,
  D1, rendering callbacks, and test promises are leaves.
- **Framework roots and generated code:** `src/hooks.server.ts`, the route
  server files under `src/routes/` (chat, event, auth, feedback, MCP and
  layout/page loads), `src/telegram-worker/index.ts`, `src/jobs-worker/`,
  `src/mcp-worker/index.ts`, `src/service-worker.ts`, and generated
  `src/lib/paraglide/{runtime,server}.d.ts`. SvelteKit/Worker/Workflow/MCP
  callbacks are runtime roots; Paraglide declarations are generated code.
- **Shared server/client integrations:** `src/shared/lib/ai/{embeddings,
  enrichment,extract-facets}.ts` and tests, `shared/lib/analytics.ts`,
  `shared/lib/db/{blocklist,
  client.server,guest-conversations,local-outbox}.ts` and tests,
  `shared/lib/feedback/alert.server.ts` and test,
  `shared/lib/html-parsing.ts`, `shared/lib/search/rerank.ts` and test,
  `shared/lib/pwa/{install,install.svelte}.ts` and test, and
  `shared/hooks/pull-to-refresh.svelte.ts`. These are direct D1,
  browser/Dexie/PWA, provider, analytics, or Effect leaf adapters; pure
  helpers within them remain TypeScript.
- **Remaining Svelte UI:** `src/shared/ui/{FeedbackDialog,LanguageSwitcher,
  MainLayout}.svelte`, `src/routes/**/*.svelte`, and layout/loading tests.
  Event handlers and remote-function calls are Svelte/framework roots; state
  remains runes and is not wrapped in an Effect runtime.

### `scripts/` and `evals/`

Operator scripts are runtime roots. The [D1 operator commands](d1.md#operator-commands) use the read-only D1 helper, the intake API, or the jobs Worker's catalog Workflow. Their CLI and Promise boundaries are not application call graphs.

The `evals/` files (`concierge/{deterministic.test,run,langfuse,multi-turn,
conversation-runner,conversations,frozen-corpus,score}.ts`, `lib/{checks,
run-agent}.ts`, `search/{run,run-semantic}.ts`,
`search/relevance/{capture,run}.ts`, and `titles/run.ts`) are evaluation
harness roots. They use Promise concurrency, timers, AI SDK calls, and test
fixtures deliberately; no product runtime imports an eval as an application
service. The deterministic test remains a pure/test boundary.

## Deliberate Promise inventory

The following is the complete set of remaining Promise categories. A new
Promise-bearing application function must either become an Effect program or
be added here with its owning runtime and behavior.

1. **SvelteKit roots and compatibility APIs.** `+server.ts`, `+page.server.ts`,
   `hooks.server.ts`, auth/chat remote functions, and the exported Promise
   adapters in auth, chat, event, import, Telegram, and shared leaf modules
   bridge into the Effect graph. They preserve SvelteKit's `RequestEvent`,
   `Response`, redirect, `RemoteForm`, nullable, and streaming contracts.
2. **Jobs Workflow roots.** `src/jobs-worker/*.ts` `step.do` callbacks call
   `Effect.runPromise` at the Workflow boundary. The Workflow owns retries,
   schedules, per-source step isolation, and step results; Effect does not
   replace those policies.
3. **Cloudflare/Worker roots.** `src/telegram-worker/index.ts`,
   `src/service-worker.ts`, and Worker/DO methods use the platform's Promise
   callback contracts. DO storage, alarms, `waitUntil`, native fetch, ack
   ordering, and retry decisions remain unchanged.
4. **D1 and database adapters.** `src/shared/lib/db/client.server.ts`,
   `blocklist.ts`, `guest-conversations.ts`, `local-outbox.ts`, and direct
   query builders return PromiseLike values. Imported repositories expose
   Effect programs around those calls; Dexie/IndexedDB and D1 own the
   underlying Promise implementation.
5. **Source HTTP and browser adapters.** The source files under
   `src/features/import/scrapers/`, `shared/lib/html-parsing.ts`, Nominatim,
   Cloudflare Playwright, and source detail/enrichment helpers retain fetch,
   browser-session, cleanup, native timeout, and one-retry contracts. The
   import core calls them as explicit leaves.
6. **AI/provider and MCP SDK contracts.** `shared/lib/ai/*`, chat tool and
   streaming callbacks, `src/mcp-worker/index.ts`, and provider SDK wrappers
   return Promises because AI SDK/MCP registration and execution consume those
   contracts. SDK-owned Zod schemas remain untouched. MCP rate limits and
   timeouts stay in the Worker handler.
   `src/chat-delivery-worker/index.ts` is a Cloudflare Durable Object root:
   serialized storage, service-binding streaming, subscribers, abort signals
   and alarms retain native Promise contracts. `delivery-auth.server.ts` is
   a Web Crypto leaf; `beginChatDeliveryCommit` is a direct binding leaf called
   by the SDK stream callback. The public bridge uses
   `forwardChatDeliveryEffect` for session, forwarding and claim cleanup.
   Browser `delivery.ts` is a fetch/ReadableStream transport boundary beneath
   the SDK parser. Reconnection retries delivery, never model execution.
   `chat-delivery-worker/workflow.ts` is a native Cloudflare Workflow root:
   `step.do` owns retry/checkpoint semantics for separate generation and
   publication stages. Interrupted read-only generation may retry under the
   original claim; publication reuses the server checkpoint. `recovery.ts`
   owns authenticated encryption, binding-request HMAC and decoded checkpoint
   boundaries. Request fences, atomic final batches, bounded alarms and
   credential cleanup remain platform contracts. The SvelteKit SDK callback's
   checkpoint helpers are direct binding leaves, like its commit gate.
7. **Auth/browser integrations.** `src/features/auth/api/client.ts`, auth
   callbacks, Web Crypto/session helpers, PostHog in `shared/lib/analytics.ts`,
   speech recognition, PWA install/update, Svelte remote calls, and browser
   event handlers are platform/client roots or leaves.
8. **Scripts and evals.** `shared/lib/ai/langfuse.server.ts` is an OpenTelemetry
   SDK leaf around the existing AI SDK leaf, with bounded export and native
   AsyncLocalStorage context. It does not own product retries or orchestration.
   All `scripts/*.ts` and `evals/**/*.ts` Promise
   entrypoints are CLI/evaluation roots. Timers and `Promise.all` are operator
   or fixture concurrency, not product orchestration.
9. **Tests and compatibility doubles.** `*.test.ts` files intentionally use
   Promise resolvers, fake timers, and mocked SDK clients to test these
   boundaries. They are not runtime application graphs.
   `agent/model-cancellation.fixture.ts` runs the production model SDK leaf in
   an isolated Bun test process with dummy keys and an intercepted transport;
   this prevents other suites' model mocks from replacing the cancellation probe.

### Retry, timeout, cancellation, and resources

- Nominatim keeps native `AbortSignal.timeout` cancellation and its existing
  single timeout retry. Effect does not add a schedule.
- Telegram owns one scoped interruption signal for final sends, callbacks, typing
  and drafts. Bot API fetch and body consumption share one Promise leaf; external
  conversation reads check the fiber signal at their boundary. D1 cannot abort an already dispatched statement.
  Interrupted programs cannot advance, while already committed writes remain durable.
  Telegram keeps Bot API `retry_after`, update claim/retry caps, DO storage
  keys, alarms, and ack ordering.
- Workflows keep step retry policies, schedules, and checkpoints. A failed
  Effect program still fails its step so the step's retry policy applies.
- Guest chat timeout and AI/tool timeout behavior remains at the existing
  request/SDK boundaries. Browser Rendering sessions close in `finally`
  through the acquisition run that owns them.
- Concierge SDK callbacks use `agent/bounded-read.ts` as a native Promise leaf:
  the per-tool timer aborts its read scope, and producer/SDK cancellation rejects
  even if a dispatched read ignores the signal. Timers/listeners are removed on settlement.
  Settling also closes the read scope so an early failed retrieval branch cannot
  leave a sibling request running.
  Effect interruption reaches the model runner through `tryPromise`'s signal;
  membership, authenticated history, and prior-context reads use `shared/lib/db/read-signal.ts` to
  check cancellation at the read boundary. Embeddings and reranking
  receive the same read signal. Reranker outages still retain retrieval order,
  while caller cancellation rejects instead of continuing fallback work. The web
  runtime connects the delivery producer's request signal to the shared turn
  Effect; detaching a browser subscriber still does not stop that producer.
- Client outboxes retain IndexedDB transaction and service-worker cache
  semantics. `AbortController`, Web Crypto, and provider cancellation remain
  native platform contracts.

## Structural audit

The migration uses these checks during implementation and before release:

```bash
bunx effect-language-service diagnostics --project tsconfig.json --format text
rg -n 'effect/unstable' src scripts evals
rg -n 'Effect\\.runPromise|Effect\\.tryPromise' src scripts evals
```

The final diagnostics result is `Checked 576 files out of 576 files. 0
errors, 0 warnings and 89 messages`; the messages are advisory suggestions,
not correctness failures. The unstable-module search is empty. `runPromise`
occurrences are limited to the roots, direct leaf adapters, and named Promise
compatibility adapters listed above. `tryPromise` is used for direct fetch,
SDK, D1, browser, timer, and provider operations; application sequencing
and expected-error handling stays in `Effect.gen`/`Effect.catchEager`.

This document is a living boundary contract. When a future async-bearing file
is added, classify it with the census command, identify its caller and owner,
record retries/cancellation/resources and expected failures, and either make
the application graph Effect-native or document the runtime/SDK exception
before updating the task checklist.

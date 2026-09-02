## Context

BA Eventos has one Bun package deployed through SvelteKit, a Telegram Worker with a Durable Object inbox, a public MCP Worker, and Trigger.dev jobs. The repository also owns HTTP clients for Telegram, search reranking, feedback alerts, enrichment, geocoding, and event-source scrapers.

The original change proposed two example seams. The implementation request expands that into a repository-wide migration of the boundaries Effect can improve without replacing Svelte or platform durability.

## Goals / Non-Goals

**Goals:**

- Use Effect Schema for every repository-owned untrusted JSON boundary.
- Use Effect programs and typed expected failures for repository-owned HTTP clients, persistence repositories, and effectful application orchestration.
- Preserve every public export, HTTP status, caller-facing Promise/nullable contract, error message, retry limit, and fallback.
- Make the boundary policy and Effect diagnostics visible to future agents and CI.
- Prove SvelteKit, Telegram Worker, MCP Worker, and Trigger.dev remain compatible.

**Non-Goals and deliberate exceptions:**

- Pure transformations, formatting, ranking, and deterministic orchestration remain ordinary TypeScript.
- Svelte component and shared UI state remain Svelte 5 runes. The `effect/unstable/*` allowlist is empty.
- Zod schemas passed directly to the AI SDK, `generateObject`, and MCP SDK remain as SDK adapters; callback values are immediately decoded into the Effect-native application graph with parity tests.
- Supabase, Dexie, AI SDK streaming/providers, Browserbase, Playwright, and PostHog remain leaf SDK adapters, but application-owned call graphs above them use Effect and typed expected failures.
- Durable Object storage, alarms, retry caps, `retry_after`, Cloudflare `waitUntil`, rate limits, and Trigger.dev task retries remain platform-owned.
- Native Web Crypto remains responsible for Telegram signing, identity hashing, and envelope encryption.
- No cross-runtime global Layer graph, service for a single local collaborator, Effect retry schedule layered over platform retries, Atom adapter, or rewrite of generated code.

## Decisions

### Pin Effect 4 and its language service exactly

Pin `effect` to `4.0.0-rc.112` and `@effect/language-service` to `0.87.2`. Put the language-service plugin after `typescript-svelte-plugin`. Run correctness diagnostics for floating Effects and obsolete APIs without enabling rules that demand migration of native `fetch`, `process.env`, Web Crypto, async functions, or SvelteKit code.

### Reuse the exact package's source and agent documentation

The installed `effect@4.0.0-rc.112` package already contains `AGENTS.md`, `ai-docs/`, and `src/`. Point repository guidance there and verify its package version. Do not add a duplicate git subtree: the exact dependency already supplies the version-matched, locally readable material, and the lockfile is the durable version pin.

### Apply one repository-wide boundary policy

1. Pure code stays TypeScript.
2. Repository-owned unknown JSON is decoded once with Effect Schema.
3. Repository-owned HTTP calls, persistence operations, and effectful use-case orchestration are Effect programs; expected transport, response, persistence, and domain failures are typed.
4. Existing dependency injection remains dependency injection.
5. `Effect.runPromise` appears only at an existing framework, client, job, Worker, or compatibility edge.
6. Existing Zod stays where a third-party SDK consumes it directly, with exact Effect decoding at the callback edge when the value enters owned code.
7. Existing native durability and retry ownership do not move.

### Inbound JSON wave

Migrate the owned inputs below while preserving their current outer contracts:

- Authenticated chat bootstrap and main chat request identity/control fields.
- Feedback and event-submission request bodies.
- Telegram webhook updates, Durable Object task payloads, and health response decoding.
- Client-provided chat response hints and last-search context.
- SvelteKit remote functions currently declared `unchecked`, using Effect Schema's Standard Schema adapter rather than exposing an Effect runtime to components.

Do not replace the AI SDK's `UIMessage`, MCP, or tool registration schema contracts. Decode the bounded application-owned projection at the callback edge rather than maintaining a second public schema.

### Owned HTTP wave

Migrate these implementations behind their existing Promise APIs and injected dependencies:

- Telegram Bot API client.
- Shared HTML fetch, Voyage reranking, Jina enrichment, and feedback email alert.
- Nominatim forward/reverse geocoding.
- BA Tourism, Eventbrite, Luma, Passline, and Venti HTTP clients/scrapers.

Keep HTML/JSON-LD extraction as pure TypeScript. Preserve the existing one-retry Nominatim timeout policy, 404/410 cancellation signals, optional-alert behavior, fail-closed reranking fallback, source-specific status handling, and injected fetch/browser clients. Do not stack Effect timeouts or retry schedules on native `AbortSignal.timeout`, Durable Object retries, or Trigger.dev retries.

### Application call-graph wave

Migrate the application-owned effectful call graphs above SDK leaves:

- Authenticated and external chat repositories for conversations, messages, turns, persistence, guest debugging, and saved-event operations.
- Shared chat-turn orchestration and provider/persistence coordination, while keeping AI SDK streaming and tool callback adapters Promise-facing where required.
- Telegram delivery, retention, health, webhook processing, and turn orchestration, while keeping Durable Object methods and Bot API compatibility methods Promise-facing.
- Event CRUD/search repositories plus import, enrichment, venue settlement/review, duplicate detection, and source orchestration, while keeping Trigger.dev job handlers as the platform run boundary.
- Auth services, remaining SvelteKit routes/actions, client transports/outboxes, PWA/browser workflows, MCP application handlers, Trigger job bodies, and repository scripts, while keeping each consuming framework callback as the runtime boundary.

Repository modules may keep compatibility Promise exports for SvelteKit, AI SDK, Cloudflare, Trigger.dev, Supabase, or tests, but their owned program is Effect-native and expected failures are represented in the error channel before compatibility mapping. Do not add superficial `Effect.tryPromise` wrappers that leave all control flow and error classification outside Effect.

Maintain a concrete inventory in `docs/effect-4.md` of each remaining Promise boundary and why the consuming framework, SDK, browser, durable platform, or compatibility contract requires it. A Promise may remain as an adapter; an undocumented application-owned Promise call graph may not.

Migration units are complete transitive application call-graph components. Do not wrap an old async workflow in one `Effect.tryPromise`; direct vendor/platform promises are wrapped at leaf adapters, while application control flow, dependency access, concurrency, expected errors, and cleanup live in Effect. Use services/Layers only for a real shared capability or scoped resource, and compose separate runtime roots for SvelteKit, browser, Workers, Trigger/Bun, and tests.

### Structural closure gates

- Every async-bearing repository file is classified as Effect-native application code, a direct SDK/platform leaf, a framework/runtime root, or pure/generated code.
- `Effect.runPromise` is confined to framework, Worker, Durable Object, Trigger, SDK callback, script, or test roots.
- `Effect.tryPromise` wraps direct vendor/platform operations, not application workflows.
- Application services and repositories expose Effect programs internally; Promise compatibility exports exist only where a current consumer contract requires them.
- Direct Supabase, Telegram, AI/provider, browser, Durable Object storage, and external fetch calls are confined to documented adapters.
- Expected validation, conflict/not-found, persistence, remote protocol, delivery, AI, and import failures use typed error channels; defects stay defects.
- Existing concurrency, retry, timeout, cancellation, resource cleanup, serialization, acknowledgement, and persistence behavior is unchanged.

### Preserve Svelte and platform durability

Svelte routes/components continue using runes and framework handlers. Effect programs end before values enter Svelte state. Durable Object `setAlarm`, attempt counters, item/seen storage, `retry_after`, `ctx.waitUntil`, MCP rate limiting/timeouts, and Trigger.dev task/schedule configuration remain unchanged and are verified by their existing deterministic tests and Worker dry-runs.

## Compatibility details

- Chat bootstrap UUID acceptance remains RFC variant with versions 1-5; excess fields are intentionally stripped from the decoded result.
- Main chat request defaults and bounded handling remain unchanged; Effect does not claim ownership of AI SDK message internals.
- `TelegramApiError` must retain `instanceof`, `errorCode`, `retryAfter`, message text, and token redaction so Durable Object retry logic is unchanged.
- Framework routes continue returning the same status and public error text.
- Existing factory and function dependency injection stays in place; no Layer is introduced for a single implementation.

## Migration plan

1. Add exact dependencies, local package-doc guidance, architecture note, and diagnostics.
2. Migrate all owned untrusted JSON inputs with compatibility tests.
3. Migrate all owned HTTP clients with focused failure/fallback tests.
4. Migrate application-owned persistence and orchestration call graphs, retaining Promise only at documented compatibility edges.
5. Run durability and channel suites, both repository test runners, type checks, build, Worker dry-runs, and OpenSpec validation.

Rollback is a source-level reversal only. No data, webhook, credential, queue, or deployment configuration changes are required.

## 1. Runtime and agent context

- [x] 1.1 Add exact `effect@4.0.0-rc.112` and `@effect/language-service@0.87.2` dependencies, update `bun.lock`, and verify `bun install --frozen-lockfile` succeeds.
- [x] 1.2 Verify the installed exact Effect package contains `AGENTS.md`, `ai-docs/`, and TypeScript source; document why no duplicate vendored subtree is added.
- [x] 1.3 Add the Effect 4 architecture note and required `AGENTS.md` pointer covering pure code, Schema, typed errors, existing dependency injection, runtime boundaries, Svelte runes, the empty unstable-module allowlist, SDK-owned schemas, and platform-owned durability.
- [x] 1.4 Configure the Effect language service after the Svelte plugin, include Effect diagnostics in `bun run check`, and verify correctness diagnostics pass without enabling broad native-platform migrations.

## 2. Repository-owned inbound JSON

- [x] 2.1 Extend `turn-authority.test.ts` with missing-field, UUID-variant, excess-field, content, and locale compatibility cases, then replace manual chat bootstrap checks with Effect Schema behind the existing nullable signature.
- [x] 2.2 Add a focused main-chat request decoder for owned identity/control fields, preserving locale/default/bounding behavior without duplicating the AI SDK `UIMessage` schema.
- [x] 2.3 Migrate feedback and event-submission request bodies to Effect Schema while preserving current status codes, defaults, validation messages, and authorization behavior.
- [x] 2.4 Migrate Telegram webhook updates, Durable Object task payloads, and webhook-health response decoding to Effect Schema while preserving exported parse contracts and 400/error behavior.
- [x] 2.5 Migrate client-provided response hints and last-search context to Effect Schema while preserving fail-closed limits, defaults, and canonical shapes.
- [x] 2.6 Replace unchecked SvelteKit remote-function inputs with Effect Schema Standard Schema adapters while preserving component-facing APIs and authorization.
- [x] 2.7 Run all focused route, chat-boundary, Telegram decoder, remote-function, and compatibility tests before moving to HTTP clients.

## 3. Repository-owned HTTP programs

- [x] 3.1 Extend `client.test.ts` with malformed envelopes, missing results, transport failures, API failures, token redaction, retry metadata, and successful generic results; implement the Telegram request as an Effect program behind the current Promise client.
- [x] 3.2 Migrate shared HTML fetch, Voyage reranking, Jina enrichment fetch, and feedback-alert delivery to Effect programs with typed failures while preserving fallbacks and public contracts.
- [x] 3.3 Migrate Nominatim forward and reverse geocoding to Effect programs, preserving native timeout cancellation and the existing single timeout retry.
- [x] 3.4 Migrate BA Tourism, Eventbrite, Luma, Passline, and Venti owned HTTP clients/scrapers to Effect programs while leaving HTML/JSON-LD transforms and browser automation as plain TypeScript.
- [x] 3.5 Run focused scraper, enrichment, reranking, feedback, HTML-fetch, and Telegram client tests; add only the smallest missing compatibility checks for changed branches.

## 4. Application-owned async and persistence call graphs

- [x] 4.1 Build a repository census of every async-bearing file under `src/`, `scripts/`, and `evals/`, classifying it as an Effect-native application graph, direct SDK/platform leaf, framework/runtime root, or pure/generated code; record callers, retries, cancellation, resources, and expected failures in `docs/effect-4.md`.
- [x] 4.2 Migrate the connected chat/data/AI application graph: authenticated/external repositories, messages, turns, persistence, guest debug, saved events, shared turn orchestration, tool execution, and provider coordination. Keep SvelteKit streaming plus AI/MCP registration and callbacks as documented SDK/runtime adapters.
- [x] 4.3 Migrate the complete Telegram/Worker graph: webhook processing, envelope handoff, delivery, external conversations, turns, health, retention, inbox processing, retry decisions, and acknowledgement ordering. Preserve Worker/Durable Object methods, storage, alarms, `waitUntil`, and Bot API Promise contracts as roots/leaves.
- [x] 4.4 Migrate the import/Trigger application graph: event repositories, duplicate detection, source coordinators, enrichment, venue settlement/review, batching/checkpoints, and Trigger job bodies. Preserve source/browser adapters as direct leaves together with Trigger retry outcomes, browser cleanup, partial-failure behavior, and persisted shapes.
- [x] 4.5 Migrate remaining owned server application components such as auth/event services and SvelteKit handlers; classify client transports/outboxes/PWA workflows, feedback/analytics integrations, repository scripts, and evals as documented framework, SDK, or operator roots. Svelte state remains runes.
- [x] 4.6 Close structural gates: `runPromise` only at approved roots, `tryPromise` only around direct vendor/platform calls, no undocumented Promise-returning application graph, direct SDK calls confined to adapters, typed expected errors, and no unclassified async-bearing files.
- [x] 4.7 Run focused chat/AI/repository, Telegram/Worker, event/import/Trigger/browser, auth/client, and script checks before full verification.

## 5. Durability and platform conformance

- [x] 5.1 Run Telegram Worker, delivery, health, webhook, task-payload, update, and retention tests; verify retry caps, alarms, `retry_after`, storage keys, and scheduled `waitUntil` ownership remain unchanged.
- [x] 5.2 Run MCP Worker and Trigger.dev job tests; verify SDK-owned Zod contracts, MCP rate limiting/timeouts, task retries, schedules, and batch ownership remain unchanged.
- [x] 5.3 Verify Svelte components/state, leaf Supabase/Dexie and provider SDK calls, AI SDK/MCP registration schemas, native Worker/Trigger/Durable Object callbacks, Web Crypto algorithms, generated Paraglide code, and all unapproved `effect/unstable/*` modules remain deliberate exceptions.

## 6. Repository verification

- [x] 6.1 Run `bun run paraglide:compile`, `bun run check`, `bun run test`, `bun test`, `bunx tsc --noEmit`, and `bun run build`, fixing only regressions caused by this change.
- [x] 6.2 Run dry-run builds for `wrangler.telegram.jsonc`, `wrangler.mcp.jsonc`, and `wrangler.jsonc` in deployment order and verify all Worker bundles compile.
- [x] 6.3 Run `openspec validate --specs --json` and `openspec validate --all --strict --no-interactive`, and verify the change remains valid without product-spec deltas.

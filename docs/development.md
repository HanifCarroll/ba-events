# Development

BA Eventos uses SvelteKit 3 RC, Svelte 5 runes, Vite 8, and TypeScript 6. Bun is the package manager and command runner.

## Checks

```sh
bun run paraglide:compile  # generate src/lib/paraglide before tests/type-check
bun run check
bun run test               # full Vitest suite, excluding evals/
bun test                   # Bun native suites, including deterministic evals
bunx vitest run <path>     # focused Vitest suite
bunx tsc --noEmit
```

`bun run test` is the authoritative full Vitest suite. Its `pretest` hook compiles Paraglide automatically. `bun test` discovers every `*.test.ts`, including `evals/concierge/deterministic.test.ts`, and runs the unit suites without Vitest-specific module mocks. Compile Paraglide once before invoking Bun's native runner directly; CI performs that as an explicit step. Both runners are supported from a clean checkout.

Unit tests do not require real Supabase credentials. Supabase clients are initialized lazily, and orchestration uses dependency-injected pure helpers.

## Chat diagnosis

For a chat URL, extract the conversation ID from `/chat/<conversationId>` and inspect the stored transcript and execution trace:

```sh
bun scripts/guest-chat-debug.ts <conversationId>
```

The service-role database read is the primary diagnostic record. A rendered page or screenshot alone does not establish the stored conversation or execution trace. If there is no guest record, inspect the authenticated `conversations` record with the existing Supabase service-role client. Diagnostic database access is read-only; credentials stay out of output.

## Search configuration

`VOYAGE_API_KEY` is the optional Voyage AI hosted reranker key for `search_events` stage 2. Without it, search falls back to retrieval order. Other environment variables are documented in [the example environment](../.env.example).

## Contracts and architecture

The exact installed `effect@4.0.0-rc.112` package provides version-matched guidance in `node_modules/effect/AGENTS.md`, `ai-docs/`, and `src/`. [Effect 4](effect-4.md) documents application boundaries and deliberate exceptions.

The main specs under [openspec/specs](../openspec/specs/) are the canonical requirements for product behavior. Changes to observable behavior, persisted shapes, security, compatibility, or channel/search/import/agent contracts belong in the affected specs alongside code and deterministic tests. Implementation-only refactors do not require spec changes. Validate changed specs with `openspec validate --specs --json`; separate proposal/design/task artifacts are not required for work planned outside OpenSpec, and existing active changes retain their lifecycle.

[Applied AI engineering work](applied-ai-engineering-work.md) tracks the remaining work for BA Eventos and Casamo, including task status and verification receipts. Local implementation and production release are separate checkpoints. Historical problem-solving records live under `docs/solutions/`; [the documentation index](README.md) links current architecture and archived plans.

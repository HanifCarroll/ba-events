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

Unit tests do not require real provider credentials. Orchestration tests use synthetic repository fixtures.

Run `node scripts/check-home-paging-browser.mjs <local-url>` with Chrome installed against an isolated local build seeded with at least 25 homepage cards, exactly eight Music cards, and a small Free view that scrolls less than two viewport heights at 390×844. It checks composer placement with and without JavaScript from 390 to 1440 pixels, mobile paging, back-to-top clearance and footer visibility, and both motion modes. It also checks that returning from event details does not count as a second install-hint visit, and that a late install prompt does not move the first card.

Tests of D1 SQL run against a fresh in-memory Miniflare D1 with `migrations/` applied (`freshD1()` in `tests/support/d1.ts`). See [D1 baseline](d1.md).

## Chat diagnosis

For a chat URL, extract the conversation ID from `/chat/<conversationId>` and inspect the stored transcript and execution trace:

```sh
bun scripts/guest-chat-debug.ts <conversationId>
```

The D1 read is the primary diagnostic record. A rendered page or screenshot alone does not establish the stored conversation or execution trace. If there is no guest record, inspect the authenticated `conversations` record with the [read-only D1 helper](d1.md#operator-commands). Keep credentials and transcripts out of shared output.

## Search configuration

`VOYAGE_API_KEY` is the optional Voyage AI hosted reranker key for `search_events` stage 2. Without it, search falls back to retrieval order. Other environment variables are documented in [the example environment](../.env.example).

Live catalog evals require Node 24, a Wrangler login with staging access, and the relevant provider keys in the environment or `.env`. Wrangler's remote bindings do not work under Bun 1.3.14, so the package scripts start Node. Compile Paraglide first on a clean checkout.

```sh
bun run eval:search --staging
bun run eval:search:semantic --staging
bun run eval:concierge --staging [case-id]
bun run eval:concierge:langfuse --staging [case-id]
```

These runs use only staging D1 and Vectorize for catalog reads. The golden search IDs expire; compare scores only with a staging corpus containing the labeled events. Keep these runs out of contributor checks.

To refresh expired golden labels, inspect the first 60 scheduled events in staging with Node 24. This command uses the Wrangler login but makes no model or embedding calls.

```sh
node evals/search/inspect-events.ts --staging
```

## Contracts and architecture

The exact installed `effect@4.1.4` package provides version-matched guidance in `node_modules/effect/AGENTS.md`, `ai-docs/`, and `src/`. [Effect 4](effect-4.md) documents application boundaries and deliberate exceptions.

The main specs under [openspec/specs](../openspec/specs/) are the canonical requirements for product behavior. Changes to observable behavior, persisted shapes, security, compatibility, or channel/search/import/agent contracts belong in the affected specs alongside code and deterministic tests. Implementation-only refactors do not require spec changes. Validate changed specs with `openspec validate --specs --json`; separate proposal/design/task artifacts are not required for work planned outside OpenSpec, and existing active changes retain their lifecycle.

[Applied AI engineering work](applied-ai-engineering-work.md) tracks the remaining work for BA Eventos and Casamo, including task status and verification receipts. Local implementation and production release are separate checkpoints. Historical problem-solving records live under `docs/solutions/`; [the documentation index](README.md) links current architecture and archived plans.

## Deployment

Production deploys only from the `deploy` job in `.github/workflows/ci.yml`, after the checks pass on a push to `main`. It deploys the five Cloudflare Workers, including the `baeventos-jobs` Worker that runs the scheduled imports. Cloudflare Workers Builds is disconnected. See [deployment](deployment.md).

## Generative tests

See [generative testing](generative-testing.md) for fast-check properties, Jazzer.js fuzz targets, and local Schemathesis API checks. Run `bun run test:generative` for all three.

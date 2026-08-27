# BA Events — SvelteKit 3

SvelteKit 3 RC + Svelte 5 (runes) + Vite 8 + TypeScript 6. **Bun only.**

## Commands

```bash
bun run paraglide:compile  # generate src/lib/paraglide before tests/type-check
bun run check
bun run test               # Vitest (SvelteKit suite, excludes evals/); pretest compiles paraglide
bun test                   # Bun native runner (all tests, incl. evals/concierge/deterministic)
bunx vitest run <path>
bunx tsc --noEmit
```

Never start the dev server.

Two test runners are supported, both green in CI from a clean checkout:

- `bun run test` — the authoritative full Vitest suite (`vitest run`), which
  excludes `evals/`. Its `pretest` hook generates the Paraglide runtime first.
- `bun test` — Bun's native runner, which discovers every `*.test.ts` (including
  `evals/concierge/deterministic.test.ts`) and runs the same unit suites without
  Vitest-specific module mocks. It needs the Paraglide runtime to exist first:
  run `bun run paraglide:compile` once (CI runs it as an explicit step).

Unit tests never require real Supabase credentials: the Supabase clients are
lazy-initialized and the agent orchestration is tested through dependency-
injected, pure helpers.

## OpenSpec

- `openspec/config.yaml` selects `spec-driven`; the main specs under `openspec/specs/` are the canonical requirements for current product behavior. Before implementing a behavioral change, read the affected main specs and keep them aligned with code and deterministic tests.
- Update the affected main spec when observable behavior, persisted shapes, security or compatibility rules, or channel, search, import, or agent contracts change. Implementation-only refactors do not need spec edits.
- For planned contract changes, use `$openspec-propose`, then `$openspec-apply-change`; sync accepted deltas with `$openspec-sync-specs` before `$openspec-archive-change`. Run `openspec validate --specs --json`; `$openspec-review-conformance` is advisory and does not replace validation or tests.

## Chat Analysis

When asked to analyze a chat URL, extract its `/chat/<conversationId>` value and inspect the stored transcript and execution trace with:

```bash
bun scripts/guest-chat-debug.ts <conversationId>
```

Use this service-role database read as the primary evidence; do not rely on `fetch_content`, the rendered page, or screenshots alone. If no guest record exists, query the authenticated `conversations` record with the existing Supabase service-role client. Keep all database access read-only and never print credentials.

## Environment Variables

### AI APIs

- `VOYAGE_API_KEY` — Voyage AI hosted reranker key for `search_events` stage-2 (optional; search falls back to retrieval order without it).

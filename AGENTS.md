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

## Compound Engineering

- Compound Engineering owns the `brainstorm -> plan -> work -> simplify -> review -> compound` workflow. Use the smallest appropriate CE skill; do not force the full loop for trivial or mechanical work.
- Plans for behavior changes must read and name the affected canonical `openspec/specs/`; code, tests, and specs must align before completion.
- docs/solutions/ contains documented solutions to past problems (bugs, best practices, and workflow patterns), organized by category with YAML frontmatter such as module, tags, and problem_type.

Infer and invoke the smallest appropriate installed CE skill from the user's desired outcome; the user does not need to activate or name a skill. Route by outcome rather than automatically running a sequence: use `ce-brainstorm` to shape an unclear feature, `ce-plan` to prepare implementation, `ce-work` for an approved plan or clear build request, `ce-debug` for unexplained broken behavior, `ce-code-review` for review, `ce-simplify-code` for behavior-preserving cleanup, and `ce-commit` for a requested local commit. Use other installed CE specialists when their descriptions directly match the request. Do not invoke `lfg`, `ce-commit-push-pr`, `ce-babysit-pr`, deployment, publishing, or another workflow with external side effects unless the user explicitly requests that outcome.

After a solved, verified problem, offer once to invoke the `ce-compound` skill at the completion checkpoint only when the work produced durable project reasoning that is not readily recoverable from the final code, tests, types, comments, or existing documentation, and losing it would plausibly cause recurrence, material risk, or substantial rediscovery. Apply this counterfactual: if the learning document disappeared, would a future engineer reading the final implementation still be likely to repeat the mistake or redo substantial investigation? If not, do not offer. Completion, effort, and diff size alone are not enough. Offer at the checkpoint so a qualifying learning can ship in the PR that produced it, and only where the repository treats captured learnings as tracked, committed knowledge.

## OpenSpec

- `openspec/config.yaml` selects `spec-driven`; the main specs under `openspec/specs/` are the canonical requirements for current product behavior. Before implementing a behavioral change, read the affected main specs and keep them aligned with code and deterministic tests.
- Update the affected main spec when observable behavior, persisted shapes, security or compatibility rules, or channel, search, import, or agent contracts change. Implementation-only refactors do not need spec edits.
- CE owns planning and implementation; canonical main specs remain current product truth. For CE-planned behavior changes, update affected main specs after verified implementation in the same branch; validate OpenSpec; do not create duplicate OpenSpec proposal/design/task artifacts. Preserve existing active OpenSpec changes; they may finish under their current lifecycle. Run `openspec validate --specs --json`; `$openspec-review-conformance` is advisory and does not replace validation or tests.

## Chat Analysis

When asked to analyze a chat URL, extract its `/chat/<conversationId>` value and inspect the stored transcript and execution trace with:

```bash
bun scripts/guest-chat-debug.ts <conversationId>
```

Use this service-role database read as the primary evidence; do not rely on `fetch_content`, the rendered page, or screenshots alone. If no guest record exists, query the authenticated `conversations` record with the existing Supabase service-role client. Keep all database access read-only and never print credentials.

## Environment Variables

### AI APIs

- `VOYAGE_API_KEY` — Voyage AI hosted reranker key for `search_events` stage-2 (optional; search falls back to retrieval order without it).

## Effect 4

The repository uses the exact `effect@4.0.0-rc.112` package installed in
`node_modules/effect`; read its `AGENTS.md`, `ai-docs/`, and `src/` for
version-matched guidance. The boundary policy and deliberate exceptions are
documented in `docs/effect-4.md`.

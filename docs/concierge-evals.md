# Concierge Eval Coverage

Two complementary suites cover the bounded concierge: a deterministic
no-model/no-DB regression suite and a live model+DB suite. Both are runnable
locally; the deterministic suite also runs in CI via the explicit `bun test`
step (`bun run test`/Vitest excludes `evals/` and does not run it).

## Deterministic suite

`evals/concierge/deterministic.test.ts` — no model, no database (Vitest-style
imports, discovered by `bun test`). It drives the pure components of the
bounded MVP with fixed inputs:

- `handleFor` — stable handles preserve response identity and original display
  position.
- `turnPlanSchema` — strict closed schema; rejects bad kinds/counts/indices,
  unknown fields, model prose, and event-ID fields.
- `buildPlannerPrompt` — bounded handles + facts, never a raw UUID.
- `runExecutor` — prior handle resolution, invalid handle/index → clarification,
  search + details/directions second, show_for_save/show_for_unsave zero
  mutation, pinned details/directions.
- `buildPriorContext` / `parseDataResponseHint` — untrusted-payload stripping,
  saved-membership stamping.
- `materializeText` — save/unsave control + login-required leads.

The unit suite in `src/features/chat/api/agent/*.test.ts`
(`planner.test.ts`, `executor.test.ts`, `orchestrate.test.ts`) pins the same
components plus the single-planner-call / fail-closed guarantees.

## Live suite

```bash
bun run eval:concierge            # all cases
bun evals/concierge/run.ts <id>   # one case by id
```

Scores search-field selection, effective limits, scope refusals, voice rules,
locale, and card grounding against each canonical source provenance id
(`cardsGrounded`). Zero chat mutations are asserted
on every save/unsave case. A non-zero exit code means at least one case failed.

## Live-suite secrets

The live suite reads environment variables through the shared client
(`src/shared/lib/db/client.server.ts`) and provider (`src/shared/lib/ai/providers.ts`).
Required for the live suite (and the CI `concierge-eval` workflow):

| Variable | Purpose |
|---|---|
| `AI_API_KEY` **or** `DEEPSEEK_API_KEY` | Text model auth (resolved `AI_API_KEY` > `DEEPSEEK_API_KEY` > `ANTHROPIC_API_KEY`) |
| `SUPABASE_URL` | Supabase project URL (dev DB) |
| `SUPABASE_ANON_KEY` | Supabase anon key (dev DB) |
| `VOYAGE_API_KEY` *(optional)* | Hosted reranker; search falls back to retrieval order without it |

Additional provider/embedding caveats:

- `search_events` embeds queries, so the live suite also needs `OPENAI_API_KEY`
  (embeddings stay on OpenAI, `text-embedding-3-small`).
- `AI_MODEL` defaults to `deepseek-v4-pro`; `AI_BASE_URL` defaults to
  `https://api.deepseek.com`.

Never commit secret values.

## CI wiring

- `.github/workflows/ci.yml` runs `bun test` (discovers
  `deterministic.test.ts`) and `bun run test` (Vitest, excludes `evals/`);
  neither runs the live suite.
- `.github/workflows/concierge-eval.yml` is a manual `workflow_dispatch` job
  that runs the live suite against the secrets above.

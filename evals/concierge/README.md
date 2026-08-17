# Concierge Eval

Two layers verify the concierge agent:

1. **Deterministic** — `deterministic.test.ts`, a test suite with **no model
   and no database** (Vitest-style imports, discovered by `bun test`). It drives
   the pure validation/fallback/reference/context components through fixed
   adversarial ledgers so the trust, grounding, and compound rules are pinned
   without a model in the loop.
2. **Live** — `run.ts`, which runs each single-turn case through the real agent
   (work loop + finalizer + validation/fallback) against the real DeepSeek model
   and the dev database, then scores deterministically.

## Deterministic suite

```bash
bun test evals/concierge/deterministic.test.ts
# or the plain `bun test` step, which discovers it
```

`bun run test` (Vitest) excludes `evals/` and does **not** run this file.

Covers, via `validatePlan` / `buildFallback` / `resolveReferences` /
`buildPriorContext` / `parseDataResponseHint` / `mutationMessage`:

- superseded vs. rejected search stages
- failed-refinement never resurrecting earlier cards
- finalizer schema/provider failure → typed fallback
- compound recommendation + directions relation
- grouped ordinal resolution + saved-marker stamping
- pinned substitution rejection
- guest injection payload stripping + DB rehydration
- Spanish mutation-receipt table

No secrets, no network, no DB. Runs in CI.

## Live suite

```bash
bun run eval:concierge            # all cases
bun evals/concierge/run.ts <id>   # one case by id
```

Scores tool choice, effective limits, filter args, voice rules, locale, and card
grounding (`cardsGrounded`). A non-zero exit code means at least one case failed.

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
  (embeddings stay on OpenAI, `text-embedding-3-small`) unless your
  `SUPABASE_ANON_KEY` environment is seeded to avoid embedding calls.
- `AI_MODEL` defaults to `deepseek-v4-flash`; `AI_BASE_URL` defaults to
  `https://api.deepseek.com`. Override either to point at a proxy.

Never commit secret values. In CI they are supplied as GitHub Actions secrets and
injected via `env:`; locally they come from your shell or `.env`.

## CI wiring

- `.github/workflows/ci.yml` runs `bun test` (which discovers
  `deterministic.test.ts`) and `bun run test` (Vitest, which excludes
  `evals/`); neither step runs the live suite.
- `.github/workflows/concierge-eval.yml` is a manual `workflow_dispatch` job that
  runs the live suite against the secrets above. It is never triggered on
  pull requests or pushes.

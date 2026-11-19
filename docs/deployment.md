# Deployment

Production deploys only from the `deploy` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). The job runs for a push to `main` after the "Tests, types, and build" and "Secret scan" jobs pass. Pull requests and other branches run the checks but never deploy. On `main`, a running deploy is never cancelled. GitHub keeps at most one running and one pending run: a newer push waits as the pending run, and a later push replaces it. So not every commit deploys on its own, but the newest push always runs and deploys everything on `main` up to it. Re-running an older `main` run from the Actions page deploys that older commit over newer code, so do it only to roll back on purpose. GitHub matches branch names without regard to case, so a branch named `Main` or `MAIN` would deploy too.

Cloudflare Workers Builds is disconnected and does not deploy on push; do not reconnect it, because it would deploy every push whatever CI says. Trigger.dev is no longer used: its scheduled jobs moved to the `baeventos-jobs` Worker on 2026-11-15.

## Order

The job builds the SvelteKit Worker. It then runs `bun scripts/check-production-bindings.ts`, which refuses to deploy while a production config still has the D1 id placeholder (see [the D1 cutover runbook](ops/d1-cutover.md)). Next, `bun run migrate:production` applies pending D1 migrations to `baeventos-production` (`wrangler d1 migrations apply --remote`), before any Worker runs code that needs them. A new migration must therefore work with the Workers still running the previous release. Finally, `bun run cloudflare:deploy` deploys the five Cloudflare Workers in this order:

1. `baeventos-telegram` (`wrangler.telegram.jsonc`)
2. `baeventos-mcp` (`wrangler.mcp.jsonc`)
3. `baeventos` (`wrangler.jsonc`)
4. `baeventos-chat-delivery` (`wrangler.chat.jsonc`)
5. `baeventos-jobs` (`wrangler.jobs.jsonc`), the scheduled import, enrichment, and retention Workflows

The deploy script uses `&&`, so a failed Worker stops the remaining deploys. The web release precedes the workflow delivery release so the staged private execution endpoint is ready before new workflows start. See [chat streaming](chat-streaming.md) for first-time provisioning. The `env -u WRANGLER_CI_*` prefixes in the script are left over from Workers Builds and are harmless outside it.

## Settings

The job reads these GitHub repository settings:

| Kind | Name | Use |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Wrangler deploys and D1 migrations. It must be allowed to deploy all five Workers, their Workflows and the jobs Worker's Browser Rendering binding, update the `baeventos.com` routes, and edit D1, Vectorize, and R2 (the bindings below). |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Wrangler account. |
| Variable | `PUBLIC_POSTHOG_KEY`, `PUBLIC_POSTHOG_HOST` | Public values compiled into the web build. |

## Data bindings

Since the D1 cutover, production stores its data on Cloudflare. Each Worker needs the bindings for its own data paths. Missing bindings never select another backend.

| Worker | Bindings |
| --- | --- |
| `baeventos` | D1 `DB` (`baeventos-production`), Vectorize `VECTORIZE` (`baeventos-events`), R2 `ARTWORK` (`baeventos-artwork`), `send_email` `EMAIL` (`alerts@` and `accounts@baeventos.com`) |
| `baeventos-mcp` | `DB`, `VECTORIZE` |
| `baeventos-telegram` | `DB`, `VECTORIZE` |
| `baeventos-jobs` | `DB`, `VECTORIZE`, R2 `INTAKE_EVIDENCE` (`baeventos-intake-evidence`) and `INTAKE_ARTWORK` (`baeventos-artwork`); workers.dev serves only the intake API |
| `baeventos-chat-delivery` | None; it reaches data through `baeventos` |

Production reads: `bin/ba-d1-read.sh "SELECT ..."` (it refuses anything but reads). Writes are reviewed `.sql` files run with `bunx wrangler d1 execute baeventos-production --remote --config wrangler.jsonc --file <file>`.

**`DB_READ_ONLY`.** While the secret `DB_READ_ONLY` is `1`, data writes are frozen, for the cutover window or a later migration that needs a freeze:

- On `baeventos`, any write request answers 503 with `Retry-After`. Reads, sign-in and sign-out, and guest chat (whose history lives in the browser) keep working. A signed-in chat turn is refused.
- On `baeventos-telegram`, webhooks answer 503, so Telegram retries them later, and its crons do nothing.
- On `baeventos-jobs`, the crons start nothing, and the intake API serves only its read operations.

Set it with `printf 1 | bunx wrangler secret put DB_READ_ONLY --config <config>`, and end it with `bunx wrangler secret delete DB_READ_ONLY --config <config>`.

Each Worker keeps its runtime variables and secrets in its own Cloudflare Settings → Variables & Secrets. Do not copy runtime secrets into GitHub. Configure the same `CHAT_DELIVERY_SECRET` on `baeventos` and `baeventos-chat-delivery`; see [chat streaming](chat-streaming.md).

## Jobs Worker

`baeventos-jobs` has no routes and no `workers.dev` URL. Cron Triggers (`triggers.crons`, UTC) call its `scheduled()` handler, which starts an ordinary Workflow instance with one ID per firing (`src/jobs-worker/schedule.ts`). Ordinary instances have no overall deadline; Workflow binding `schedules` were not used because their instances get only a one-hour budget.

| Workflow | Schedule | Buenos Aires | Work |
| --- | --- | --- | --- |
| `baeventos-daily-scrape` | `0 9 * * *` | 06:00 | Meetup, BA Tourism, and Luma imports, one retried step each, run concurrently so a hung source cannot delay the others; then finalization and enrichment of the new events |
| `baeventos-guest-retention` | `0 10 * * *` | 07:00 | Delete guest lifecycle and transcript rows older than 30 days |
| `baeventos-enrichment-catchup` | `0 13 * * *` | 10:00 | Retry failed enrichment once and drain the pending backlog |
| `baeventos-source-check` | none | | Manual no-write catalog read of each source |

Two more crons run in `scheduled()` itself (`CRON_TASKS`): `mark-past-events` hourly (`0 * * * *`) and the Vectorize reconcile at 03:00 Buenos Aires (`0 6 * * *`). Both require D1 and Vectorize. That makes five crons, the most a Worker may have. See [D1](d1.md#catalog).

Every step retries twice more with exponential backoff from one second (Trigger.dev's old three attempts) and keeps the old per-task time budget as its timeout. Secrets: `INTAKE_API_TOKEN` (the intake API, see [Instagram intake](instagram-intake.md)), `DEEPSEEK_API_KEY` (categorization, description extraction, translation, and facets), and `OPENAI_API_KEY` (embeddings). They reach shared code through `process.env` (`nodejs_compat_populate_process_env`). Run a job by hand with `bunx wrangler workflows trigger <workflow> --config wrangler.jobs.jsonc`, and read it with `bunx wrangler workflows instances describe <workflow> latest --config wrangler.jobs.jsonc`.

## Local checks

From the repository root:

```sh
bun run cloudflare:build
bunx wrangler deploy --config wrangler.jsonc --dry-run
bun run telegram:dry-run
bun run mcp:dry-run
bun run chat:dry-run
bun run jobs:dry-run
```

Do not run a real deploy from local checks. `bun run cloudflare:deploy` and `bun run jobs:deploy` are reserved for the `deploy` job or an explicitly approved operator run.

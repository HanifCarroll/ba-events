# Deployment

Production deploys only from the `deploy` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). The job runs for a push to `main` after the "Tests, types, and build" and "Secret scan" jobs pass. Pull requests and other branches run the checks but never deploy. On `main`, a running deploy is never cancelled. GitHub keeps at most one running and one pending run: a newer push waits as the pending run, and a later push replaces it. So not every commit deploys on its own, but the newest push always runs and deploys everything on `main` up to it. Re-running an older `main` run from the Actions page deploys that older commit over newer code, so do it only to roll back on purpose. GitHub matches branch names without regard to case, so a branch named `Main` or `MAIN` would deploy too.

Cloudflare Workers Builds is disconnected and does not deploy on push; do not reconnect it, because it would deploy every push whatever CI says. Trigger.dev is no longer used: its scheduled jobs moved to the `baeventos-jobs` Worker on 2026-11-15.

## Order

The job builds the SvelteKit Worker, then runs `bun run cloudflare:deploy`, which deploys the five Cloudflare Workers in this order:

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
| Secret | `CLOUDFLARE_API_TOKEN` | Wrangler deploys. It must be allowed to deploy all five Workers, their Workflows and the jobs Worker's Browser Rendering binding, and update the `baeventos.com` routes. |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Wrangler account. |
| Variable | `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `PUBLIC_POSTHOG_KEY`, `PUBLIC_POSTHOG_HOST` | Public values compiled into the web build. |

Each Worker keeps its runtime variables and secrets in its own Cloudflare Settings → Variables & Secrets. Do not copy runtime secrets into GitHub. Configure the same `CHAT_DELIVERY_SECRET` on `baeventos` and `baeventos-chat-delivery`; see [chat streaming](chat-streaming.md).

## Jobs Worker

`baeventos-jobs` has no routes and no `workers.dev` URL. Its Workflows start from cron `schedules` on their bindings, in UTC:

| Workflow | Schedule | Buenos Aires | Work |
| --- | --- | --- | --- |
| `baeventos-daily-scrape` | `0 9 * * *` | 06:00 | Meetup, BA Tourism, and Luma imports, one retried step each; then enrichment of the new events |
| `baeventos-guest-retention` | `0 10 * * *` | 07:00 | Delete guest lifecycle and transcript rows older than 30 days |
| `baeventos-enrichment-catchup` | `0 13 * * *` | 10:00 | Retry failed enrichment once and drain the pending backlog |
| `baeventos-source-check` | none | | Manual no-write catalog read of each source |

Every step retries twice more with exponential backoff from one second (Trigger.dev's old three attempts) and keeps the old per-task time budget as its timeout. Secrets: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (database and the private acquisition cache), `DEEPSEEK_API_KEY` (categorization, description extraction, translation, and facets), and `OPENAI_API_KEY` (embeddings). They reach shared code through `process.env` (`nodejs_compat_populate_process_env`). Run a job by hand with `bunx wrangler workflows trigger <workflow> --config wrangler.jobs.jsonc`, and read it with `bunx wrangler workflows instances describe <workflow> latest --config wrangler.jobs.jsonc`.

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

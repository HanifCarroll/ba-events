# Deployment

Production deploys only from the `deploy` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). The job runs for a push to `main` after the "Tests, types, and build" and "Secret scan" jobs pass. Pull requests and other branches run the checks but never deploy. On `main`, a running deploy is never cancelled. GitHub keeps at most one running and one pending run: a newer push waits as the pending run, and a later push replaces it. So not every commit deploys on its own, but the newest push always runs and deploys everything on `main` up to it. Re-running an older `main` run from the Actions page deploys that older commit over newer code, so do it only to roll back on purpose. GitHub matches branch names without regard to case, so a branch named `Main` or `MAIN` would deploy too.

Cloudflare Workers Builds and the Trigger.dev GitHub app are disconnected. Neither deploys on push any more; do not reconnect them, because they would deploy every push whatever CI says.

## Order

The job builds the SvelteKit Worker, then runs `bun run cloudflare:deploy`, which deploys the four Cloudflare Workers in this order:

1. `baeventos-telegram` (`wrangler.telegram.jsonc`)
2. `baeventos-mcp` (`wrangler.mcp.jsonc`)
3. `baeventos` (`wrangler.jsonc`)
4. `baeventos-chat-delivery` (`wrangler.chat.jsonc`)

The deploy script uses `&&`, so a failed Worker stops the remaining deploys. The web release precedes the workflow delivery release so the staged private execution endpoint is ready before new workflows start. See [chat streaming](chat-streaming.md) for first-time provisioning. The `env -u WRANGLER_CI_*` prefixes in the script are left over from Workers Builds and are harmless outside it.

Trigger.dev jobs deploy last, with `bun run trigger:deploy --external-id "$GITHUB_SHA"`. A failed Cloudflare deploy skips them.

## Settings

The job reads these GitHub repository settings:

| Kind | Name | Use |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Wrangler deploys. It must be allowed to deploy all four Workers and update the `salidasba.com` and `baeventos.com` routes (the old domain stays routed so it can redirect). |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Wrangler account. |
| Secret | `TRIGGER_ACCESS_TOKEN` | Trigger.dev personal access token (`tr_pat_…`) for project `proj_lqttmibcdepaslelatth`. |
| Variable | `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `PUBLIC_POSTHOG_KEY`, `PUBLIC_POSTHOG_HOST` | Public values compiled into the web build. |

Each Worker keeps its runtime variables and secrets in its own Cloudflare Settings → Variables & Secrets. Do not copy runtime secrets into GitHub. Configure the same `CHAT_DELIVERY_SECRET` on `baeventos` and `baeventos-chat-delivery`; see [chat streaming](chat-streaming.md).

## Trigger.dev

Trigger.dev is a separate runtime and never receives the Cloudflare token. `trigger.dev deploy` reads `TRIGGER_ACCESS_TOKEN` from the environment, deploys to `prod` by default, and builds the image on Trigger.dev's servers, so the runner needs no Docker. `--external-id` ties the deployment to the commit, and a re-run of the same commit returns the existing version instead of building it again. Production runtime variables stay in Trigger.dev.

## Local checks

From the repository root:

```sh
bun run cloudflare:build
bunx wrangler deploy --config wrangler.jsonc --dry-run
bun run telegram:dry-run
bun run mcp:dry-run
bun run chat:dry-run
```

Do not run a real deploy from local checks. `bun run cloudflare:deploy` and `bun run trigger:deploy` are reserved for the `deploy` job or an explicitly approved operator run.

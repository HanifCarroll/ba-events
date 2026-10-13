# Cloudflare Workers Builds

The repository has one production Workers Build. It runs the existing clean-checkout gates, builds the SvelteKit Worker, then deploys the four Cloudflare Workers in this order:

1. `baeventos-telegram` (`wrangler.telegram.jsonc`)
2. `baeventos-mcp` (`wrangler.mcp.jsonc`)
3. `baeventos-chat-delivery` (`wrangler.chat.jsonc`)
4. `baeventos` (`wrangler.jsonc`)

The deploy script uses `&&`, so a failed Worker stops the remaining deploys. Workers Builds pins the connected `baeventos` identity in Wrangler; the three explicit secondary deployments unset that per-build identity guard, while the final public deployment keeps it.

## Dashboard setup

In Cloudflare Dashboard → Workers & Pages → `baeventos` → Settings → Builds → Connect:

| Setting | Value |
| --- | --- |
| Git account | GitHub account that owns `HanifCarroll/ba-events` |
| Git repository | `HanifCarroll/ba-events` |
| Production branch | `main` |
| Root directory | `/` (repository root) |
| Build command | `bun run cloudflare:build` |
| Deploy command | `bun run cloudflare:deploy` |
| Non-production branch builds | Off |
| Build watch paths | Include `*`; exclude none |
| Build variable | `BUN_VERSION=1.3.14` |
| Build secrets | None |

Connect only `baeventos`. The deploy command publishes the other three Workers too; connecting those Workers separately would create duplicate, concurrent builds. Keep each Worker's existing runtime variables and secrets in its own Settings → Variables & Secrets. Do not copy runtime secrets into Build variables. Configure the same `CHAT_DELIVERY_SECRET` on `baeventos` and `baeventos-chat-delivery`; see [chat streaming](chat-streaming.md) for setup and the private binding topology.

Workers Builds can use its automatically generated API token. If an existing token is selected instead, it must be authorized to deploy all four Workers and update the `baeventos.com` routes.

After saving, push a commit to `main` and verify the build log and all four Worker deployment histories. The names in the dashboard must match the `name` values in the four Wrangler configs.

## Trigger.dev deployment

Trigger.dev remains a separate runtime and must not be deployed with the Cloudflare API token. Use Trigger.dev's native Git integration to connect `HanifCarroll/ba-events`, track `main` for production, and keep preview deployments off unless they are deliberately needed. Trigger.dev then deploys its jobs automatically from the same pushes without a GitHub Actions workflow.

Keep its existing production runtime variables in Trigger.dev. `bun run trigger:deploy` remains the manual fallback. A successful Cloudflare build does not itself deploy or update Trigger.dev jobs.

## Local checks

From the repository root:

```sh
bun run cloudflare:build
bunx wrangler deploy --config wrangler.jsonc --dry-run
bun run telegram:dry-run
bun run mcp:dry-run
bun run chat:dry-run
```

Do not run a real deploy from local checks. `bun run cloudflare:deploy` is reserved for Workers Builds or an explicitly approved operator run.

References: [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) and [build watch paths](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/).

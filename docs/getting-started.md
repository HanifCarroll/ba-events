# Getting started

Choose the smallest environment you need. The code checks and component gallery work without a production account; running the full service requires infrastructure setup.

## 1. Run the checks

Install Bun 1.3.14, clone the repository, and run:

```sh
bun install --frozen-lockfile
bun run cloudflare:ci
```

`cloudflare:ci` generates translations, runs the Bun and Vitest suites, checks Svelte/TypeScript and Effect diagnostics, and checks whitespace. These checks use synthetic fixtures and do not require a real `.env` file. To compile the app without connecting to providers, use placeholder public settings:

```sh
PUBLIC_SUPABASE_URL=https://example.supabase.co \
PUBLIC_SUPABASE_ANON_KEY=example-anon-key \
PUBLIC_POSTHOG_KEY= \
PUBLIC_POSTHOG_HOST=https://us.i.posthog.com \
bun run build
```

The build compiles the application; it does not deploy it. These placeholders are for compilation only, not a working app instance.

## 2. Explore the UI

```sh
bun run storybook
```

Open `http://localhost:6006`. The gallery supplies mock authentication, saved events, analytics, and speech helpers. See [Storybook](storybook.md) for browser tests and accessibility checks.

## 3. Configure a full development instance

```sh
cp .env.example .env
```

Use a separate Supabase project and fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and the matching `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`. The service-role key is privileged and server-only. Never prefix it with `PUBLIC_` or commit it.

Database bootstrap is currently manual. `supabase/schema.sql` and `supabase/seed.sql` are historical starting points, while `supabase/migrations/` records later changes, including Supabase-specific Auth and policy requirements. They are **not a verified one-command fresh-database installer**. Review and reconcile the schema and migration sequence in a disposable project before enabling app traffic. Do not apply the seed or maintenance scripts to production. Work on a reproducible bootstrap is a useful contribution.

For chat, supply your own DeepSeek generation key and OpenAI embedding key. Voyage reranking and Langfuse tracing are optional. Keep analytics disabled by leaving `PUBLIC_POSTHOG_KEY` empty. Use `LANGFUSE_TRACING_ENABLED=false` for local work unless you deliberately want to export traces to your own project.

```sh
bun run dev
```

The web app listens on `http://localhost:3001`. Configure your Supabase Auth site URL and callback allowlist for that local origin. Catalog-backed routes require a configured database and event data. Durable web-chat delivery also requires the Cloudflare services described in [chat streaming](chat-streaming.md); starting Vite alone does not provision those services.

## Optional channels and ingestion

- **Telegram:** create your own bot, endpoint, and independent webhook/HMAC secrets. Follow [the Telegram guide](telegram-bot.md).
- **MCP:** use your own Worker and database bindings. The maintained public contract is in [the MCP specification](../openspec/specs/public-event-mcp/spec.md).
- **Imports:** use your own Trigger.dev project and provider credentials. Review [import/enrichment](event-import-enrichment.md) and [browser acquisition](browser-acquisition.md) before running a job.
- **Live evaluations:** commands beginning `eval:` may call models, read configured databases, export traces, or spend credits. They are not part of the contributor quick start. Read [concierge evaluations](concierge-evals.md) first.

## Deploying a fork

The checked-in `wrangler*.jsonc` files, Worker/service names, routes, account identifiers, and Trigger project identify the maintained BA Eventos installation. They are public configuration, not credentials. Copy and adapt them for your own account; do not run `deploy`, `cloudflare:deploy`, `trigger:deploy`, or webhook setup commands unchanged.

Update the canonical host in `src/hooks.server.ts` and review app metadata and branded links for your own domain.

Provision your own Worker bindings, Workflows, Durable Object migrations, Supabase schema/policies, authentication redirects, and runtime secrets. Shared delivery secrets must match across the relevant private bindings. [Workers Builds](cloudflare-workers-builds.md) describes the maintainer's deployment topology, not an automatic setup service for forks.

Local environment files, `.dev.vars`, database dumps, traces, and scratch output stay untracked. The project never needs another contributor's production credentials.

# Exploring the code

The repository is public so you can inspect the implementation behind [baeventos.com](https://baeventos.com). Start with the [architecture overview](architecture.md) and its code map. The checks and component gallery below let you explore locally without production accounts or credentials.

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

## Reading the operational code

Deployment files, database migrations, channel integrations, and import jobs are included to show how the hosted product works. They are maintainer references, not a supported installation guide. Self-hosting is outside the project’s scope.

- [Chat streaming](chat-streaming.md) explains durable delivery.
- [The MCP specification](../openspec/specs/public-event-mcp/spec.md) describes public event discovery.
- [Import/enrichment](event-import-enrichment.md) describes the catalog pipeline.
- [Workers Builds](cloudflare-workers-builds.md) documents the hosted deployment topology.

Deployment and webhook commands target the maintained installation. Live evaluations and imports can call providers, read configured databases, export traces, or incur costs. They are not part of local code exploration. Use the deterministic tests and Storybook fixtures above.

Local environment files, `.dev.vars`, database dumps, traces, and scratch output stay untracked. Production credentials and user data are not needed to inspect or check the code.

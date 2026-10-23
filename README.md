# BA Eventos

Find things to do in Buenos Aires through a bilingual AI concierge, a browsable event catalog, Telegram, or an MCP client.

[Try BA Eventos](https://baeventos.com) · [Getting started](docs/getting-started.md) · [Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md)

## What it does

- Searches events by date, neighborhood, budget, and interests, combining semantic and full-text retrieval with optional reranking.
- Builds event cards and links from server-validated catalog results. The assistant can search and explain; saving events stays under the user's control.
- Supports Spanish and English, guest conversations, signed-in saved events, and contextual follow-up questions.
- Shares the concierge across the web app and a private-chat Telegram bot, and exposes public event discovery through an MCP server.
- Imports and enriches event listings through background jobs, with source provenance and review tools for operators.

## Start with the code

Requirements: **Bun 1.3.14** and Git. Use the committed lockfile; the app currently uses SvelteKit 3 and Effect 4 release candidates.

```sh
git clone https://github.com/HanifCarroll/ba-events.git
cd ba-events
bun install --frozen-lockfile
bun run cloudflare:ci
```

The deterministic tests and type checks run without API keys or a production database. To explore the interface with fixture data:

```sh
bun run storybook
```

Storybook runs on port 6006. A full app instance needs your own Supabase database and provider credentials; see [getting started](docs/getting-started.md). Live AI evaluations, scraping, and deployment are separate operator tasks and can incur costs.

## How it fits together

| Part | Implementation |
| --- | --- |
| Web app | SvelteKit 3 RC, Svelte 5, TypeScript, Tailwind CSS |
| Concierge | Vercel AI SDK, DeepSeek generation, OpenAI embeddings, optional Voyage reranking |
| Data and identity | Supabase Postgres, pgvector, Auth, row-level security |
| Delivery | Cloudflare Workers, Durable Objects, Workflows |
| Imports | Trigger.dev jobs, source adapters, Playwright/browser providers |
| Quality | Vitest, Bun tests, Storybook, frozen search and concierge evaluations |

See the [architecture overview](docs/architecture.md), [chat trust boundary](docs/chat-trust-boundary.md), and [documentation index](docs/README.md). The [OpenSpec specifications](openspec/specs/) describe expected product behavior.

## Project status

BA Eventos is a maintained application whose source is available for learning, contributions, and adaptation. It is not yet a one-command self-hosting distribution: database history and provider setup still require operator review. The checked-in deployment configuration describes the maintained installation and must be adapted before deploying a fork.

Event coverage depends on upstream sources. Listings and AI-written recommendations can be incomplete or outdated; follow the event's source link to confirm details.

## Contribute

Bug reports, documentation fixes, accessibility improvements, deterministic tests, and focused pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and review expectations. For vulnerabilities or exposed credentials, use [private security reporting](SECURITY.md).

## License and data

Project code and documentation are available under the [MIT license](LICENSE). Third-party event descriptions, posters, linked media, dependency code, and brand rights are not relicensed by this project; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No production database, user conversations, or service credentials are included as part of the development setup.

# Contributing to BA Eventos

Thanks for helping improve event discovery in Buenos Aires. Start with a focused issue or pull request; discuss large changes before implementing them.

## Local setup

Follow [getting started](docs/getting-started.md). Bun 1.3.14 and the committed `bun.lock` are the supported dependency baseline. Use your own development services when you need the full app. The test suite and Storybook do not need production credentials.

## Before opening a pull request

```sh
bun install --frozen-lockfile
bun run cloudflare:ci
```

Then run the [compile-only build](docs/getting-started.md#1-run-the-checks) with placeholder public settings or your own development environment.

For UI changes, also inspect the affected Storybook stories and run the relevant browser checks from [the Storybook guide](docs/storybook.md). For database changes, include a migration and its rollback/compatibility notes. Do not run maintenance scripts against the hosted service.

Keep changes small and describe the user-visible problem, resulting behavior, and checks performed. Follow the existing TypeScript and Svelte conventions. If behavior or a persisted contract changes, update the relevant specification under `openspec/specs/` alongside the code and deterministic tests. [The development guide](docs/development.md) explains the two test runners and canonical contracts.

AI/search changes need evidence beyond a passing unit suite. See [the AI release checklist](docs/ai-release-checklist.md) for frozen evaluations, quality review, and release decisions. Live evaluations and imports are opt-in and may spend provider credits. A pull request does not authorize a production deployment.

## Safe contributions

- Never commit `.env`, `.dev.vars`, credentials, database exports, real user conversations, or telemetry downloads. Use synthetic fixtures and `.env.example` placeholders.
- Keep API keys and service-role credentials server-side. Use separate development accounts and least-privilege access.
- Run `gitleaks git . --log-opts="--all" --redact` when checking your branch for accidental secrets. The repository configuration excludes only known synthetic fixtures.
- Report suspected vulnerabilities privately using [SECURITY.md](SECURITY.md), without including credentials in public issues.
- Respect upstream source terms and access limits; do not add code that bypasses access controls.

Be respectful, explain tradeoffs, and keep feedback about the work. Contributions are accepted under the project's [MIT license](LICENSE); only submit material you have the right to contribute. Third-party content retains its own terms.

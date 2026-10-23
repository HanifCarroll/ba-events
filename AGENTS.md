# Repository guidance

Use Bun 1.3.14 and the committed lockfile. Read [the development guide](docs/development.md) and the affected specifications under `openspec/specs/` before changing behavior.

Run `bun run cloudflare:ci` and `bun run build` for changes that affect the application or its setup. Keep provider-backed evaluations separate from deterministic tests; do not use production credentials or run imports/deployments as part of a contributor check.

Do not commit credentials, user conversations, telemetry exports, or local scratch output. Use synthetic fixtures. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

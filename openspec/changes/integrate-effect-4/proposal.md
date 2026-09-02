## Why

BA Eventos spans browser, SvelteKit, Cloudflare Worker, Durable Object, MCP, and Trigger.dev code, but asynchronous work, validation, and expected failures use several local conventions. Effect 4 can give coding agents one compiler-visible model for those concerns while preserving the product and channel contracts.

## What Changes

- Pin one exact Effect 4 release and use the matching source and agent documentation shipped in that package.
- Add concise repository guidance for where Effect belongs: untrusted boundaries and side-effecting programs, not pure helpers or Svelte component state.
- Add Effect-specific compiler diagnostics for floating effects and obsolete Effect 4 APIs.
- Migrate every repository-owned untrusted JSON boundary to Effect Schema, while preserving framework-facing nullable, Promise, Standard Schema, and HTTP contracts.
- Migrate every repository-owned HTTP client path to an Effect program with typed failures and decoded responses while preserving existing callers and retry behavior.
- Keep Svelte 5 runes for frontend reactivity and keep Durable Objects, Cloudflare execution contexts, and Trigger.dev responsible for durable retries, alarms, background work, and persistence.
- Exclude unofficial Svelte Atom adapters, third-party SDK-owned schemas, pure transformations, generated code, and SDK/platform durability that Effect would only duplicate.

This is an internal architecture change. It does not alter user-visible behavior, persisted data, event search, concierge behavior, Telegram delivery semantics, MCP contracts, or import/enrichment behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None.

## Impact

- Dependencies: `package.json` and `bun.lock` gain exact Effect 4 runtime and agent-tooling versions.
- Agent context: repository guidance points to the version-matched Effect source and docs installed with the exact dependency.
- Application code: all owned request decoders and HTTP boundaries adopt Effect while preserving exported contracts.
- Verification: the normal typecheck/test/build path gains focused Effect diagnostics and boundary tests.
- Operations: existing SvelteKit, Telegram Worker, MCP Worker, Durable Object, and Trigger.dev deployment ownership remains unchanged.

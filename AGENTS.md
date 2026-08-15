# BA Events — SvelteKit 3 (migration in progress)

SvelteKit 3 RC + Svelte 5 (runes, forced) + Vite 8 (Rolldown) + TypeScript 6. **Bun only** — never npm/npx for installs (`bunx` for one-shot CLIs is fine).

This repo is a **migration target**. The legacy TanStack Start (React) app lives at
`/Users/hanifcarroll/projects/ba-events` — treat it as **READ-ONLY reference**. Never modify it.
Never start a dev server (`vite dev`) — the user's own servers run; verify with
`bun run check`, `bun run test`, and scoped `vitest run <paths>` only.

## If you are a migration worker (pi / DeepSeek agent)

1. Read `migration/CONTRACTS.md` **in full** before writing any code. It defines import
   aliases, env rules, server-only rules, and the React→Svelte / TanStack→SvelteKit mappings.
2. Read your task card `migration/cards/<NN>-<name>.md`. Your scope is exact — do not touch
   files outside it, do not add dependencies, do not run `git`.
3. Every `.svelte` / `.svelte.ts` file you write MUST pass
   `bunx @sveltejs/mcp svelte-autofixer <file>` until it returns no issues.
   Docs lookup: `bunx @sveltejs/mcp get-documentation "<section>"` (list: `list-sections`).
4. Write your evidence report to `migration/evidence/<NN>-<name>.md` per your card's format.

## Commands

```bash
bun run check        # svelte-kit sync + svelte-check (whole project)
bun run test         # vitest run (whole suite)
bunx vitest run <path>  # scoped tests
bunx tsc --noEmit    # fast type check
```

## Layout (vertical slices preserved from legacy repo)

```
src/routes/          SvelteKit routes (+page.svelte, +page.server.ts, +server.ts)
src/features/        #features/* — auth, chat, events, import (business logic)
src/shared/          #shared/*  — ui, lib (db, ai, utils), hooks
src/shared/lib/paraglide/  generated i18n output (DO NOT EDIT — see #paraglide alias)
src/lib/paraglide/   #paraglide/* — generated paraglide runtime/messages (DO NOT EDIT)
src/trigger/         #trigger/* — Trigger.dev background jobs
messages/            en.json / es.json (paraglide source, base locale: es)
migration/           plan, contracts, task cards, worker evidence, logs
```

Hard rules: TypeScript strict, no `any`; subpath imports carry explicit extensions
(`#shared/lib/logger.ts`, `#paraglide/messages.js`); no barrel `index.ts` re-exports;
server-only modules get the `.server.ts` suffix; no TanStack/React imports anywhere in this repo.

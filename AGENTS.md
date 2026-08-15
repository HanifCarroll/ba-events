# BA Events — SvelteKit 3

SvelteKit 3 RC + Svelte 5 (runes) + Vite 8 + TypeScript 6. **Bun only.**

This directory **is** the production app (`HanifCarroll/ba-events`). Do not write to
`/Users/hanifcarroll/projects/ba-events-sveltekit` (leftover sibling).

## If you are a pi / DeepSeek worker

1. Read your task card `migration/cards/<name>.md`. Scope is exact.
2. Do not run `git`. Do not start `vite dev`. Do not add dependencies unless the card says so.
3. TypeScript strict, no `any`. Subpath imports with explicit extensions
   (`#shared/lib/logger.ts`, `#paraglide/messages.js`). No barrel `index.ts`.
4. Server-only modules use the `.server.ts` suffix.
5. Every `.svelte` / `.svelte.ts` you edit must pass
   `bunx @sveltejs/mcp svelte-autofixer <file>` with `issues: []`.
6. Write evidence to `migration/evidence/<name>.md`.
7. Acceptance checks on the card must actually be run.

## Commands

```bash
bun run check
bun run test
bunx vitest run <path>
bunx tsc --noEmit
```

Never start the dev server. The user owns `:3001`.

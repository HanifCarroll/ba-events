# Card FIX — login 500 missing_context

## Objective

Fix the production 500 on `/login` (and any other `EXCLUDED_ROUTES` page).

## Repro

`bun run preview` on port 4173. `GET /login` returns:

```
Error: https://svelte.dev/e/missing_context
    at initAuthContext (src/features/auth/hooks/auth-context.svelte.ts:68:9)
    at src/routes/+layout.svelte:18:16
```

`/login` is in `EXCLUDED_ROUTES` and does not wrap `MainLayout`, but the root `+layout.svelte` still calls `initAuthContext` during SSR. `createContext`/`setContext` requires an established Svelte context tree that is missing on this path (or `initAuthContext` is calling `getContext` before `setContext`).

## Required change

Read `src/features/auth/hooks/auth-context.svelte.ts` and `src/routes/+layout.svelte`. Make `/login`, `/register`, and `/auth/callback` render without 500 while still initializing auth context for the rest of the app.

Boring/safe options (pick one, document):
- Always `setContext` in the root layout (never `getContext` first).
- Or skip `initAuthContext` on excluded routes *and* make `useAuthContext()` safe when unset (return a logged-out default).

Do not change login UX. Do not add deps. Do not start a new long-running server — verify with a one-shot request against the already-running preview if it exists, or `bun run preview` is already up on 4173; you may `curl -sI http://127.0.0.1:4173/login`.

## Acceptance

1. `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4173/login` → 200 (not 500).
2. Same for `/register` and `/auth/callback`.
3. `bunx tsc --noEmit` zero errors in files you touched.
4. `bunx @sveltejs/mcp svelte-autofixer` clean on every `.svelte`/`.svelte.ts` you edited.
5. Evidence: `migration/evidence/FIX-login-500.md`.

## Boundaries

Only the files needed to fix this 500. No git. No new deps. No redesign of auth.

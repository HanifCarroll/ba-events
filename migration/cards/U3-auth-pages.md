# Card U3 — auth-pages + shared-ui

## Objective

Port the auth routes and the custom shared UI shell components from React to Svelte 5,
per `migration/CONTRACTS.md`.

## Scope (legacy base = /Users/hanifcarroll/projects/ba-events)

| Legacy | New |
|---|---|
| src/routes/login.tsx | src/routes/login/+page.svelte + +page.server.ts |
| src/routes/register.tsx | src/routes/register/+page.server.ts (redirect → /login, preserve query passthrough) |
| src/routes/auth/callback.tsx | src/routes/auth/callback/+page.svelte (+ +page.server.ts if the legacy exchange is server-side — read it) |
| src/routes/-components/LanguageSwitcher.tsx | src/shared/ui/LanguageSwitcher.svelte |
| src/shared/ui/MainLayout.tsx | src/shared/ui/MainLayout.svelte |
| src/shared/ui/FeedbackDialog.tsx | src/shared/ui/FeedbackDialog.svelte |
| src/shared/ui/SkipLink.tsx | src/shared/ui/SkipLink.svelte |
| src/shared/ui/PullToRefreshIndicator.tsx + src/shared/hooks/usePullToRefresh.ts | src/shared/ui/PullToRefreshIndicator.svelte + src/shared/hooks/pull-to-refresh.svelte.ts (attachment pattern: `{@attach ...}`) |
| src/shared/ui/ErrorBoundary.tsx | src/shared/ui/ErrorBoundary.svelte (`<svelte:boundary>` wrapper) |

## Notes

1. **login**: legacy is a magic-link form. New: `+page.server.ts` form action calling the
   browser-safe sign-in path — read legacy carefully: if sign-in email is sent via the
   browser Supabase client (`signInWithMagicLink` from `#features/auth/api/client.ts`), the
   form stays client-side with `use:enhance`-free progressive posting to a form action is
   WRONG — mirror legacy exactly (client call + pending/sent UI states), using a form
   action only if legacy posted to the server. Honor `?redirect=` after login.
2. **callback**: legacy exchanges `code`/`token_hash` (client via `exchangeCodeForSession`
   or server via S1's `exchangeCode`). Preserve both flows + error UI + final redirect.
3. **MainLayout**: sidebar nav (nav_* messages), active-route highlighting via
   `page.url.pathname` from `$app/state`, sign-out via S1's `auth.remote.ts` `signOut`
   command, auth state via `useAuthContext()`. `EXCLUDED_ROUTES = ['/login',
   '/auth/callback']` gating lives in the ROOT LAYOUT (U4) — MainLayout itself just renders
   the shell.
4. **LanguageSwitcher**: `setLocale` from `#paraglide/runtime.js` + persist via S1's
   `updateLocalePreference` remote command when signed in. No full-page reload (legacy
   removed it — server hook now syncs the cookie).
5. **FeedbackDialog / SkipLink / PullToRefreshIndicator**: straightforward ports;
   pull-to-refresh uses `$app/navigation` `refreshAll()` (SvelteKit 3's `invalidateAll`
   replacement) — confirm via docs.
6. Autofixer every file until clean.

## Acceptance

1. Autofixer clean; `bunx tsc --noEmit` zero errors in your files.
2. Forbidden-string grep (`@tanstack`, `from 'react'`, `import.meta.env`) → empty.
3. `bun run check` passes for the rest of the repo (no collateral breakage).

## Boundaries

No deps, no git, no dev server. No primitives (S2 done), no root `+layout.svelte` (U4),
no saved/profile/event pages (U2), no chat (U1).

## Evidence

`migration/evidence/U3-auth-pages-shared-ui.md` per CONTRACTS.md §10. Include the exact
login submit path (client vs form action) with the legacy evidence line.

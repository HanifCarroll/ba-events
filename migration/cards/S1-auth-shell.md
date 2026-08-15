# Card S1 — auth-shell

## Objective

Port the auth feature end-to-end as SvelteKit infrastructure: request hooks, locals, session
helpers, auth server functions + remote wrappers, and the client-side auth state context.
Per `migration/CONTRACTS.md`.

## Scope (legacy base = /Users/hanifcarroll/projects/ba-events)

| Legacy | New |
|---|---|
| src/features/auth/api/session.ts | src/features/auth/api/session.server.ts |
| src/features/auth/api/server.ts | src/features/auth/api/server.server.ts |
| src/features/auth/api/client.ts | src/features/auth/api/client.ts |
| src/features/auth/api/rate-limit.ts | src/features/auth/api/rate-limit.server.ts |
| src/features/auth/hooks/useAuthContext.ts | src/features/auth/hooks/auth-context.svelte.ts |
| src/features/auth/hooks/useProfileMutations.ts | src/features/auth/hooks/profile-mutations.svelte.ts |
| (new) | src/features/auth/api/auth.remote.ts |
| src/shared/providers/AuthProvider.tsx | ABSORBED into root layout + auth-context (no 1:1 file) |
| __root.tsx beforeLoad locale-sync | src/hooks.server.ts (see step 4) |
| (new) | src/hooks.server.ts, src/app.d.ts, src/routes/+layout.server.ts |

`src/features/auth/index.ts` barrel: skip (note contents in evidence).

## Conversions

1. **session.server.ts**: `getSessionUser(event: RequestEvent): Promise<SessionUser | null>`
   using `createSupabaseServerClient(event)` from `#shared/lib/db/server-client.server.ts`.
   `requireAuth(event, redirectTo?)` / `requireAdmin(event, redirectTo?)` → plain fns that
   `throw redirect(303, ...)` from `@sveltejs/kit` (legacy used router redirect with
   `search: { redirect }` → new URL `/login?redirect=<path>`).
2. **server.server.ts**: `signOut(event)`, `exchangeCode(event, { code?, tokenHash?, type? })`,
   `deleteAccount(event, { userId })`, `updateLocalePreference(event, locale)` — plain async
   fns, dynamic imports inlined to top-level static imports.
3. **auth.remote.ts**: remote wrappers (contract §5) for `signOut`, `updateLocalePreference`,
   `deleteAccount` (`command`), and `getSessionUser` is NOT wrapped (layout data covers it).
   Check exact `command` signature via
   `bunx @sveltejs/mcp get-documentation "kit/remote-functions"`.
4. **hooks.server.ts**: `sequence` from `@sveltejs/kit/hooks` combining, in order:
   (a) Supabase handle — create per-request server client, `auth.getUser()`, fetch profile,
       set `event.locals.user/profile/isAdmin` (and a `safeGetSession` pattern if the legacy
       code has one — it doesn't, keep simple);
   (b) legacy locale sync — if `event.locals.profile?.locale` exists and differs from the
       `PARAGLIDE_LOCALE` cookie, set the cookie (`path: '/'`, `maxAge: 34560000`);
   (c) the existing paraglide handle (already in the file — keep it LAST so
       `transformPageChunk` sees the final locale).
   **app.d.ts**: declare `App.Locals { user, profile, isAdmin }` with imported types.
5. **client.ts**: browser Supabase client via `$env/static/public` (`PUBLIC_SUPABASE_URL`,
   `PUBLIC_SUPABASE_ANON_KEY`); keep all exported helpers (`signInWithMagicLink`,
   `exchangeCodeForSession`, `fetchProfile`, `updateDisplayName`, `resetSupabaseBrowserClient`,
   `getSession`, `signOut`); DELETE the `useAuth` React hook.
6. **auth-context.svelte.ts**: `createContext` (from 'svelte') exposing
   `{ user, profile, isAdmin, loading }` backed by `$state`; an
   `initAuthContext(initial)` called once by the root layout, and `useAuthContext()` getter
   preserving the legacy call-site shape. Also subscribe to browser-client
   `onAuthStateChange` to refresh (legacy relied on React Query refetch + window focus —
   mirror with the supabase listener, not polling).
7. **profile-mutations.svelte.ts**: legacy `useProfileMutations` → exported functions calling
   the remote wrappers + updating context state; preserve toast behavior (`svelte-sonner`).
8. **+layout.server.ts**: `export const load = async (event) => ({ session: await getSessionUser(event) })`
   — actually use `event.locals` populated by the hook (avoid double fetch): return
   `{ user, profile, isAdmin }` from locals (serialize-safe plain data).
   Do NOT touch `+layout.svelte` beyond what step 6 needs (card U4 composes the final
   layout); if you must set context, add the minimal script block and leave the file
   otherwise as-is, marking it `@migration TODO: U4 composes layout`.
9. **rate-limit.server.ts**: straight port (Supabase RPC + service client); note its
   exported function names in evidence (card A1 consumes them).

## Acceptance

1. `bunx tsc --noEmit 2>&1` — zero errors in your files (missing-module errors naming
   in-flight cards tolerated).
2. `bunx @sveltejs/mcp svelte-autofixer` clean on every `.svelte`/`.svelte.ts` you touched.
3. `grep -rn "@tanstack\|from 'react'" src/features/auth src/hooks.server.ts src/app.d.ts` → empty.
4. `bun run check` still passes for files outside your scope (no collateral breakage).

## Boundaries

No deps, no git, no dev server. No UI components, no routes beyond `+layout.server.ts`.
`src/routes/+layout.svelte` only the minimal context wiring (U4 owns it).

## Evidence

`migration/evidence/S1-auth-shell.md` per CONTRACTS.md §10. Must list: every exported name
from session.server.ts / server.server.ts / auth.remote.ts / client.ts / auth-context.svelte.ts,
and the rate-limit function signatures.

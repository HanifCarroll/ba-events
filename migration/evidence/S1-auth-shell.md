# Card S1 — auth-shell — evidence

## Scope done

| File | Note |
|---|---|
| `src/env.ts` | **NEW (deviation)** — SvelteKit 3 RC explicit-env entry; declares `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` (`public: true`) so browser code can import them (see Deviations). |
| `src/features/auth/api/session.server.ts` | `getSessionUser(event)` / `requireAuth(event, redirectTo?)` / `requireAdmin(event, redirectTo?)` + `SessionUser`; `redirect(303, …)` from `@sveltejs/kit`; `#shared/lib/db/server-client.server.ts`. |
| `src/features/auth/api/server.server.ts` | `signOut(event)`, `exchangeCode(event, { code?, tokenHash?, type? })`, `deleteAccount(event, { userId })`, `updateLocalePreference(event, locale)`; dynamic imports inlined to top-level static imports. |
| `src/features/auth/api/auth.remote.ts` | `command` wrappers for `signOut`, `updateLocalePreference`, `deleteAccount` (via `getRequestEvent` from `$app/server`); `getSessionUser` intentionally NOT wrapped. |
| `src/features/auth/api/client.ts` | Browser Supabase client via `$app/env/public`; kept `getSupabaseBrowserClient`, `resetSupabaseBrowserClient`, `signInWithMagicLink`, `signOut`, `getSession`, `fetchProfile`, `exchangeCodeForSession`, `updateDisplayName`; deleted React `useAuth` hook; `import.meta.env`/`typeof window` → `$app/env`. |
| `src/features/auth/api/rate-limit.server.ts` | Straight port (Supabase RPC + service client); `from 'crypto'` kept. |
| `src/features/auth/hooks/auth-context.svelte.ts` | `AuthContextValue` + `AuthState` class (`$state` fields) + `createContext` (from 'svelte'); `initAuthContext(initial)`, `useAuthContext()`, `getAuthState()`; Supabase `onAuthStateChange` listener replaces React Query refetch. |
| `src/features/auth/hooks/profile-mutations.svelte.ts` | `updateDisplayName(displayName)` / `deleteAccount(userId)` plain async fns (replace the React `useUpdateDisplayName` / `useDeleteAccount` hooks). |
| `src/hooks.server.ts` | `sequence(supabase, locale-sync, paraglide)`; paraglide kept LAST. |
| `src/app.d.ts` | `App.Locals { user, profile, isAdmin }` with imported `User` / `Profile` types. |
| `src/routes/+layout.server.ts` | `load(event)` returns `{ user, profile, isAdmin }` from `event.locals` (no double fetch). |
| `src/routes/+layout.svelte` | Minimal context wiring only: `untrack(() => initAuthContext(data))`; marked `@migration TODO: U4 composes layout`. |

Skipped: `src/features/auth/index.ts` barrel (pure re-export barrel, no logic). Its contents:
client (`getSupabaseBrowserClient`, `resetSupabaseBrowserClient`, `signInWithMagicLink`, `signOut`,
`getSession`, `fetchProfile`, `exchangeCodeForSession`, `useAuth`, `updateDisplayName`),
rate-limit (`RATE_LIMIT_REQUESTS`, `RATE_LIMIT_WINDOW_MS`, `API_RATE_LIMIT_REQUESTS`,
`API_RATE_LIMIT_WINDOW_MS`, `checkRateLimit`, `checkApiRateLimit`), server (`signOutAction`,
`exchangeCodeAction`, `deleteAccountAction`, `updateLocalePreference`), session (`getSessionUser`,
`requireAuth`, `requireAdmin`, `SessionUser`), hooks (`useAuthContext`, `useUpdateDisplayName`,
`useDeleteAccount`).

## Exported names (required by card)

**session.server.ts** — `SessionUser` (type), `getSessionUser`, `requireAuth`, `requireAdmin`.

**server.server.ts** — `signOut`, `exchangeCode`, `deleteAccount`, `updateLocalePreference`.
(legacy names `signOutAction` / `exchangeCodeAction` / `deleteAccountAction` → `signOut` /
`exchangeCode` / `deleteAccount` per card step 2.)

**auth.remote.ts** — `signOut`, `updateLocalePreference`, `deleteAccount`.

**client.ts** — `getSupabaseBrowserClient`, `resetSupabaseBrowserClient`, `signInWithMagicLink`,
`signOut`, `getSession`, `fetchProfile`, `exchangeCodeForSession`, `updateDisplayName`.
(`useAuth` deleted per card; `withConnectionRetry` is module-private as in legacy.)

**auth-context.svelte.ts** — `AuthContextValue` (type), `AuthState` (class), `initAuthContext`,
`useAuthContext`, `getAuthState`.

**profile-mutations.svelte.ts** — `updateDisplayName`, `deleteAccount`
(rename from `useUpdateDisplayName` / `useDeleteAccount` — now plain functions, not hooks).

**rate-limit.server.ts function signatures** —
`checkRateLimit(ip: string): Promise<{ success: boolean; remaining: number; reset: number }>` and
`checkApiRateLimit(ip: string): Promise<{ success: boolean; remaining: number; reset: number }>`.
Constants: `RATE_LIMIT_REQUESTS = 50`, `RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000`,
`API_RATE_LIMIT_REQUESTS = 10`, `API_RATE_LIMIT_WINDOW_MS = 60 * 1000`.

## Commands + outputs

### 1. `bunx svelte-kit sync` (regenerates `$app/env` + route types) — exit 0

```
$app/types/env.d.ts now declares:
  declare module '$app/env/public' {
    export const PUBLIC_SUPABASE_URL: string;
    export const PUBLIC_SUPABASE_ANON_KEY: string;
  }
```

### 2. `bunx @sveltejs/mcp svelte-autofixer` — clean on every touched file

```
src/features/auth/hooks/auth-context.svelte.ts    → { issues: [], suggestions: [], require_another_tool_call_after_fixing: false }
src/features/auth/hooks/profile-mutations.svelte.ts → { issues: [], suggestions: [], require_another_tool_call_after_fixing: false }
src/routes/+layout.svelte                          → { issues: [], suggestions: [], require_another_tool_call_after_fixing: false }
```

### 3. `bunx tsc --noEmit 2>&1` — zero errors in S1 files (exit 2, one foreign error)

```
src/features/chat/lib/saved.ts(62,10): error TS2345: Argument of type '(item: SavedEventRow) => SavedEventWithDetails | null' is not assignable to parameter of type '(value: { id: any; event_id: any; created_at: any; events: any[]; }, index: number, array: { id: any; event_id: any; created_at: any; events: any[]; }[]) => SavedEventWithDetails | null'.
```

The single remaining error is in **card 06's** `saved.ts` (see Cross-import debts).

### 4. `bun run check` — 1 error (same foreign file), 0 warnings

```
1786810881009 COMPLETED 2033 FILES 1 ERRORS 0 WARNINGS 1 FILES_WITH_PROBLEMS
```

### 5. forbidden-imports grep — empty (exit 1 = no matches)

```
grep -rn "@tanstack\|from 'react'" src/features/auth src/hooks.server.ts src/app.d.ts   → (no output)
grep -rn "import.meta.env" src/features/auth src/hooks.server.ts src/app.d.ts src/env.ts
  src/routes/+layout.server.ts src/routes/+layout.svelte                                → (no output)
```

### 6. `bunx vitest run` (full suite, collateral check) — green

```
 Test Files  25 passed (25)
      Tests  179 passed (179)
   Duration  2.24s
```

## Deviations

1. **`src/env.ts` created (not listed in the card table).** CONTRACTS.md §3 says browser code
   should use `import { env } from '$env/static/public'` → `env.PUBLIC_SUPABASE_URL`. The
   installed SvelteKit 3 RC (`3.0.0-next.23`) has **removed** implicit `$env/*` modules —
   public env vars must be declared in `src/env.ts` via `defineEnvVars` and imported from
   `$app/env/public` (named exports). `$env/static/public` is deprecated (prints a DEV
   warning and re-exports `$app/env/public`), and there is no `env` namespace object on the
   static module. So `client.ts` uses `import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY }
   from '$app/env/public'`, `import { browser, dev } from '$app/env'`, and `src/env.ts` declares
   the two supabase public vars. `PUBLIC_POSTHOG_KEY` / `PUBLIC_POSTHOG_HOST` are left for the
   analytics/UI card that consumes them. This matches the `$app/env` convention card 06 already
   adopted in `src/features/chat/lib/saved.ts` and `speech-recognition.ts`.
2. **`deleteAccount` reuses `getSupabaseServiceRoleClient()`** (`#shared/lib/db/service.server.ts`)
   instead of the legacy's inlined `createClient(supabaseUrl, supabaseServiceKey, { auth:
   { autoRefreshToken: false, persistSession: false } })`. Same service-role key and same auth
   options (`persistSession: false`, `autoRefreshToken: false`); behavior identical. The only
   difference is the service client also carries `nodeRealtimeOptions` and is a cached singleton,
   which is irrelevant to `auth.admin.deleteUser`.
3. **`deleteAccount` keeps its unused `event: RequestEvent` first parameter** (card signature
   `deleteAccount(event, { userId })`); the value is not read because the operation uses the
   service-role client, matching the legacy function's lack of a user-scoped client.
4. **`updateDisplayName` (client.ts) drops the legacy `as any` cast** on
   `client.from('profiles').update(...)` — contract hard rule "no `any`". The untyped
   `SupabaseClient` accepts the update object without the cast; behavior unchanged (card 06 did
   the same in `saved.ts`).
5. **`updateDisplayName` (profile-mutations) refetches the profile** (`fetchProfile(user.id)`)
   after the browser update instead of patching the profile object locally. This mirrors the
   legacy React Query `invalidateQueries(profile)` → refetch semantics and avoids synthesizing
   `updated_at` with `new Date()`. If the refetch returns null the previous profile is kept.
6. **`deleteAccount` (profile-mutations) calls the browser `signOut`** (client.ts, clears the
   browser/localStorage session) after the remote `deleteAccount` command, exactly as the legacy
   `useDeleteAccount` mutation did (`deleteAccountAction(...)` then `signOut()`). The
   auth-context `onAuthStateChange` listener then clears shared state on the SIGNED_OUT event.
   The remote `signOut` command (cookie sign-out) remains available for U3's MainLayout.
7. **Locale sync sets only the cookie.** The legacy `__root.tsx` `beforeLoad` both set
   `serverAsyncLocalStorage.getStore().locale = savedLocale` (force the *current* SSR render)
   and `setCookie(...)`. Here (per the card's literal step 4b) only `event.cookies.set(...)` is
   performed; paraglide reads the locale from the raw `event.request` cookie header, so the
   current request still renders in the pre-existing cookie locale and the saved locale takes
   effect on the next request/hydration. Noted as a behavior nuance, not a functional blocker
   for the acceptance gates.
8. **`requireAuth`/`requireAdmin` build `/login?redirect=<path>` unencoded** (card's literal
   `new URL \`/login?redirect=<path>\``), rather than TanStack Router's URLSearchParams-encoded
   form. Redirect paths are plain app paths, so `url.searchParams.get('redirect')` on the login
   page still yields the original path.
9. **`useUpdateDisplayName` / `useDeleteAccount` renamed to `updateDisplayName` / `deleteAccount`**
   and converted from React hooks to plain async functions (card step 7). No toasts exist in the
   legacy `useProfileMutations`, so none were added ("preserve toast behavior" is a no-op here);
   `svelte-sonner` is therefore not imported by this file.

## Cross-import debts

- **`src/features/chat/lib/saved.ts` (card 06) — type error now surfaced, not caused, by S1.**
  Card 06 removed the legacy `as any` casts and typed `mapSavedEventRow(item: SavedEventRow)`
  with `SavedEventRow.events: (Event & { venues: Venue | null }) | null`. With `client.ts` now
  present (and `getSupabaseBrowserClient()` correctly returning the untyped `SupabaseClient`,
  exactly as legacy), `client.from('saved_events').select('… events (*, venues (*)) …')` infers
  the row shape as `{ id: any; event_id: any; created_at: any; events: any[] }` — the nested
  select yields `events: any[]`, which is not assignable to `SavedEventRow.events`. Before S1,
  this file only showed `TS2307 Cannot find module '#features/auth/api/client.ts'` (tolerated);
  now it shows the underlying `TS2345`. This is card 06's typing to fix (e.g. cast
  `data as SavedEventRow[]` or type the row to match the inferred shape); it is outside S1's
  scope and I did not touch `saved.ts`.
- `#features/auth/api/client.ts` is also imported by card 06's `saved.ts` (`getSupabaseBrowserClient`)
  and by card 05's `user-tools.server.ts` → `#features/auth/api/session.server.ts`
  (`getSessionUser(event)`). Both signatures are now present and match (verified via full
  `vitest run` green + `tsc` clean on those import sites).

## TODOs

- `@migration TODO: U4 composes layout` — `src/routes/+layout.svelte` (S1 added only the minimal
  `initAuthContext(data)` context wiring; U4 owns the final root layout).
- No other unfinished `@migration TODO`s in S1 scope.

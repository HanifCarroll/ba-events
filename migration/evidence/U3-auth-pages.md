# Card U3 — auth-pages + shared-ui — evidence

## Scope done

| File | Note |
|---|---|
| `src/routes/login/+page.server.ts` | **NEW** — `load` redirects already-authenticated visitors to `?redirect=` (fallback `/`), mirroring legacy `beforeLoad` → `redirect({ to: '/' })` (see Deviations). |
| `src/routes/login/+page.svelte` | **NEW** — magic-link form, **fully client-side** (no form action). Same markup/classes as legacy `login.tsx`, `Mail/Sparkles/Check` icons, error + pending/sent states. |
| `src/routes/register/+page.server.ts` | **NEW** — `load` → `redirect(303, '/login' + (event.url.search \|\| ''))`, mirroring legacy `beforeLoad` `redirect({ to: '/login' })` and preserving any query passthrough. |
| `src/routes/register/+page.svelte` | **NEW** — one-comment placeholder. Required companion: SvelteKit needs a `+page.svelte` next to a `+page.server.ts`; it never renders (load always redirects). |
| `src/routes/auth/callback/+page.server.ts` | **NEW** — server-visible `?error`/`?code`/`?token_hash` exchange via S1's `exchangeCode(event, …)` from `server.server.ts`; success → `redirect(303, '/')`, failure → returns `{ error }`. |
| `src/routes/auth/callback/+page.svelte` | **NEW** — error UI + spinner; handles the client-only `#token_hash` implicit flow via the new `exchangeCode` remote command, then full navigation to `/`. |
| `src/shared/ui/SkipLink.svelte` | **NEW** — trivial `<a href="#main-content">` port of `SkipLink.tsx`. |
| `src/shared/ui/PullToRefreshIndicator.svelte` | **NEW** — indicator div (`data-pull-indicator` + inner `data-pull-icon`), `RefreshCw` icon, initial `height:0;opacity:0`. |
| `src/shared/hooks/pull-to-refresh.svelte.ts` | **NEW** — `pullToRefresh(options): Attachment<HTMLElement>` port of `usePullToRefresh`; DOM-manipulated 60fps touch logic identical, default `onRefresh = refreshAll()`. |
| `src/shared/ui/ErrorBoundary.svelte` | **NEW** — `<svelte:boundary onerror=…>` + `failed` snippet; same default UI (`AlertCircle`, DEV-only message via `dev` from `$app/env`, "Try Again" → `window.location.reload()`), optional `fallback` snippet. |
| `src/shared/ui/LanguageSwitcher.svelte` | **NEW** — `getLocale/setLocale/locales` from `#paraglide/runtime.js`; `updateLocalePreference` remote when signed in; collapsed tooltip + `DropdownMenu` with `child` snippet `asChild` port. |
| `src/shared/ui/FeedbackDialog.svelte` | **NEW** — controlled `open`/`onOpenChange`; PostHog survey `capture`s read `window.posthog` (set by U4's PostHogInit); submitted/auto-close/reset logic identical. |
| `src/shared/ui/MainLayout.svelte` | **NEW** — full sidebar shell: mobile header/menu/backdrop, desktop sidebar, nav (`nav_*`), active-route via `page.url.pathname`, sign-out via S1's `signOut` command, auth via `useAuthContext()`, FeedbackDialog wiring. |
| `src/features/auth/api/auth.remote.ts` | **MODIFIED (additive)** — added `exchangeCode` remote command wrapping S1's `server.exchangeCode` (needed by the callback hash flow). Existing exports untouched. |

## Commands + outputs

### 1. Autofixer — `issues: []` on every written file

```
src/routes/login/+page.svelte                      → issues: []
src/routes/register/+page.svelte                   → issues: []
src/routes/auth/callback/+page.svelte              → issues: []
src/shared/ui/SkipLink.svelte                      → issues: []
src/shared/ui/PullToRefreshIndicator.svelte        → issues: []
src/shared/ui/ErrorBoundary.svelte                 → issues: []
src/shared/ui/LanguageSwitcher.svelte              → issues: []
src/shared/ui/FeedbackDialog.svelte                → issues: []  (8 advisory suggestions, see note)
src/shared/ui/MainLayout.svelte                    → issues: []  (2 advisory suggestions, see note)
src/shared/hooks/pull-to-refresh.svelte.ts         → issues: []
```

`FeedbackDialog`'s 8 suggestions and `MainLayout`'s 2 suggestions are advisory only —
`issues` is empty (the gate). They are the autofixer's `$effect` heuristics firing on
faithful `useEffect → $effect` ports (timer auto-close, `getPostHog()`, `localStorage`
persistence, `String(...)`). None assign state in a way that loops; the tool itself says to
ignore such suggestions when the function is a side effect.

### 2. Forbidden-string grep — empty

```
$ grep -rnE "@tanstack|from 'react'|import\.meta\.env" <all U3 files>
(empty — good)
```

### 3. `bunx tsc --noEmit` — zero errors in U3 files

`bunx tsc --noEmit 2>&1 | grep <U3 files>` → `(empty)`.

### 4. `bun run check` — zero errors in U3 files (no collateral breakage)

`svelte-check` reports `5825 FILES 2961 ERRORS 20 FILES_WITH_PROBLEMS`; **none are U3
files**. `grep <U3 files>` over the full check output → empty. Remaining `src/` errors are
all in in-flight sibling cards (`features/chat/components/*`, `features/events/components/*`,
`routes/profile/+page.svelte`), and 2945 of the 2961 are stale `build/_app/immutable/*.js`
build artifacts (pre-existing, documented in U4's evidence too). Running my fixes actually
lowered the total from 2967 → 2961 (removed my 6 transient errors).

## Login submit path (client vs form action)

**Client-side, no form action** — the legacy sends the magic-link email through the browser
Supabase client, so the Svelte port keeps the submit client-side.

Legacy evidence lines (`legacy/src/routes/login.tsx`):

```ts
import { signInWithMagicLink } from '@/features/auth/api/client'
// …
const handleMagicLink = async (e: React.FormEvent) => {
  e.preventDefault()
  // …
  await signInWithMagicLink(email)
  setMagicLinkSent(true)
```

New equivalent (`src/routes/login/+page.svelte`):

```svelte
import { signInWithMagicLink } from '#features/auth/api/client.ts'
// …
async function handleMagicLink(e: SubmitEvent) {
  e.preventDefault()
  // …
  await signInWithMagicLink(email)
  magicLinkSent = true
}
```

`+page.server.ts` only does the already-authenticated redirect (legacy `beforeLoad`); it has
no form action.

## Deviations

1. **login `?redirect=` honoured** — legacy `beforeLoad` redirected to `/` unconditionally.
   Card note 1 asks to "Honor `?redirect=` after login", so `+page.server.ts` redirects to
   `event.url.searchParams.get('redirect') ?? '/'`. The redirect target is not carried through
   the magic-link email (legacy's `emailRedirectTo` is `/auth/callback`), so the callback
   still lands on `/` — same as legacy. Note: legacy's `requireAuth` *generates* `?redirect=`
   but nothing in the legacy app ever consumed it (a dead feature); this port honours it only
   on the already-authenticated `/login` visit.

2. **callback `?code=` flow is server-side** — legacy exchanged in a client `useEffect` via
   `exchangeCodeAction` (a `createServerFn` POST). SvelteKit's equivalent runs it in
   `+page.server.ts` `load` (cookies flow through `event.cookies`), then `redirect(303, '/')`.
   Side effect: the "Completing sign in…" spinner is not shown for the `code` flow (redirect
   happens pre-render). The error UI and final redirect are preserved. The `#token_hash`
   implicit flow (URL fragment, invisible to the server) stays client-side, matching legacy.

3. **callback final redirect uses full navigation** — legacy `navigate({ to: '/' })` +
   `queryClient.invalidateQueries({ queryKey: ['session'] })`. SvelteKit has no React Query
   session cache; the `303` (code flow) and `window.location.href = '/'` (hash flow) both do a
   full document navigation so the root layout re-seeds auth state from the new session
   cookies.

4. **`exchangeCode` remote wrapper added to S1's `auth.remote.ts`** — the callback's client-side
   hash flow needs a remote `command` for `server.exchangeCode`. This is an additive, non-breaking
   change to an S1-owned file (the card's note 2 explicitly routes the exchange through "S1's
   `exchangeCode`").

5. **`ConversationHistory` (U1) not rendered** — the legacy `MainLayout` renders
   `<ConversationHistory collapsed={…} />`, which belongs to U1 (out of scope). Replaced with a
   `@migration TODO` placeholder in the same DOM position.

6. **sign-out clears shared auth state** — legacy `queryClient.setQueryData(['session'], null)`
   + `invalidateQueries`. New port calls `getAuthState()` and nulls `user`/`profile` after the
   `signOut` command (the module-level accessor is exported for exactly this), then `goto('/')`.

7. **tooltip `asChild` merges** — for the collapsed sign-out button, Radix `asChild` chains the
   tooltip trigger's `onclick` with `handleSignOut`. bits-ui's `child` snippet does not chain
   automatically (Svelte later attribute wins), so the port chains manually:
   `(props.onclick as ((evt: MouseEvent) => void) | undefined)?.(e); handleSignOut();`. Collapsed
   nav items and the LanguageSwitcher use the same `<div {...props}>` wrapper the legacy used.

8. **pull-to-refresh default `onRefresh`** — legacy default was `window.location.reload()`.
   Card note 5 directs `$app/navigation` `refreshAll()`, so the attachment default is
   `() => refreshAll()`. The indicator now carries `data-pull-indicator` so the attachment can
   find it (legacy located it via a React ref); `data-pull-icon` unchanged.

9. **LanguageSwitcher `setLocale`** — kept the legacy `setLocale(locale)` (default
   `reload: true`, i.e. a full reload on locale switch — the legacy comment says exactly
   "updates cookie and reloads page"). Card note 4's "no full-page reload (legacy removed it —
   server hook now syncs the cookie)" refers to the *load-time* locale sync (legacy
   `__root.tsx` moved it server-side; S1's `handleLocaleSync` ports it), not the switcher.

10. **register `+page.svelte`** — the card table listed only `+page.server.ts`, but SvelteKit
    requires a page component beside it; added a one-comment placeholder that never renders.

## Cross-import debts

- `ConversationHistory` (U1) — not yet ported; `MainLayout` leaves a `@migration TODO`
  placeholder. Not blocking for the shell.
- U4's `+layout.svelte` already imports `MainLayout` (default) and renders it for
  non-`EXCLUDED_ROUTES` pages — dependency satisfied by this card.

## TODOs

- `@migration TODO: render ConversationHistory here once U1 ports it.` — in
  `src/shared/ui/MainLayout.svelte` (legacy: `<ConversationHistory collapsed={collapsed && !mobileMenuOpen} />`).

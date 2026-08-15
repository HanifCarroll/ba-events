# Migration Contracts

Binding rules for every worker. The legacy repo (`/Users/hanifcarroll/projects/ba-events`)
is the behavioral source of truth and is **read-only**. This repo
(`/Users/hanifcarroll/projects/ba-events-sveltekit`) is the only place you write.

## 1. Golden rules

- Bun only. Never install or upgrade dependencies (missing dep → stop, report in evidence).
- Never run `git`, never start `vite dev`, never modify the legacy repo, never edit
  `src/lib/paraglide/**` (generated).
- TypeScript strict. No `any`. Keep the legacy file's exported names unless the contract
  says otherwise — call sites are ported against them.
- Port, don't redesign. Preserve behavior, comments that carry intent, and test semantics.
  If the legacy code has an obvious framework-independent bug, keep the behavior and note it
  in your evidence (do not silently fix).
- No barrel files. Direct imports only, with explicit extensions:
  `import { logger } from '#shared/lib/logger.ts'`.
- `@migration TODO:` annotate anything you could not finish, and list it in evidence.

## 2. Import aliases (package.json `imports`)

| Legacy | New | Notes |
|---|---|---|
| `@/shared/lib/x` | `#shared/lib/x.ts` | |
| `@/features/chat/api/y` | `#features/chat/api/y.ts` | all features likewise |
| `@/paraglide/messages` | `#paraglide/messages.js` | generated; `.js` extension |
| `@/paraglide/runtime` | `#paraglide/runtime.js` | `getLocale`, `setLocale`, `locales` |
| `@/lib/analytics` | `#shared/lib/analytics.ts` | moved into shared |
| `@/lib/analytics.server` | `#shared/lib/analytics.server.ts` | moved + `.server` |
| relative `./x` | `./x.ts` **unchanged** | colocated files keep relative imports |
| `lucide-react` | `lucide-svelte` | same icon names, PascalCase |
| `sonner` | `svelte-sonner` | `toast.success(...)` API same |

Deleted without replacement: `@tanstack/*`, `react`, `react-dom`, `react-hook-form`,
`@hookform/resolvers`, `react-markdown`, `vite-tsconfig-paths`, `workbox-build`,
`@/shared/lib/query.ts` (TanStack Query keys — invalidation is replaced by SvelteKit
`refreshAll`/`invalidate` and remote-function `.refresh()`).

## 3. Environment variables

- **Server-side code** (anything `.server.ts`, routes' `+*.server.ts`, endpoints, and any
  module also used by Trigger jobs): keep `process.env.X` exactly as the legacy code does.
  Dev loads `.env`; Trigger jobs get env from Trigger.dev. Do NOT convert these to `$env/*`.
- **Browser-reachable public vars**: SvelteKit 3 RC removed implicit `$env/static/public`.
  Declare public vars in `src/env.ts` via `defineEnvVars` from `@sveltejs/kit/env`, then
  import them from `$app/env/public`:
  `import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$app/env/public'`.
  Runtime flags: `import { browser, dev } from '$app/env'` (not `$app/environment`).
  Renames: `VITE_SUPABASE_URL→PUBLIC_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY→PUBLIC_SUPABASE_ANON_KEY`, `VITE_PUBLIC_POSTHOG_KEY→PUBLIC_POSTHOG_KEY`,
  `VITE_PUBLIC_POSTHOG_HOST→PUBLIC_POSTHOG_HOST`.
  If you need a new public var, add it to `src/env.ts` (`{ public: true }`) — do not invent
  `$env/*` imports.
- Modules imported by BOTH the app and Trigger jobs (e.g. `db/client.server.ts`,
  `ai/providers.ts`) MUST use `process.env` — `$app/env/*` does not resolve under Trigger.

## 4. Server-only modules

- Files that read secrets, use service-role keys, or must never ship to the browser get the
  `.server.ts` suffix (SvelteKit enforces this at build). Renames:
  `db/client.ts` → `db/client.server.ts` (all import sites use `#shared/lib/db/client.server.ts`),
  `db/server.ts` → `db/server-client.server.ts`, `db/service.ts` → `db/service.server.ts`,
  `analytics.server.ts` stays.
- `db/guest-conversations.ts` and `db/local-outbox.ts` use Dexie/IndexedDB — they are
  **browser-only**, NOT server modules. Keep plain `.ts`.

## 5. Canonical server pieces (signatures every card must match)

```ts
// #shared/lib/db/server-client.server.ts
import { createServerClient } from '@supabase/ssr'
import type { RequestEvent } from '@sveltejs/kit'

export function createSupabaseServerClient(event: RequestEvent) {
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables')
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => event.cookies.getAll(),
      setAll: (cookies) =>
        cookies.forEach(({ name, value, options }) =>
          event.cookies.set(name, value, { ...options, path: options?.path ?? '/' })
        ),
    },
  })
}
```

- `SessionUser` type (`{ user, profile, isAdmin }`) lives in
  `#features/auth/api/session.server.ts`; `getSessionUser(event: RequestEvent)` there replaces
  the legacy `createServerFn` version. Shell card S1 wires `hooks.server.ts` + `locals`.
- Legacy `getCookies/setCookie/setResponseHeader` from `@tanstack/react-start/server` never
  appear in new code — cookies go through `event.cookies`, headers through `event.setHeaders`.

### Data functions vs remote wrappers

Feature-porting cards convert each legacy `createServerFn` into a **plain exported async
function** in a `.server.ts` module. User-scoped functions (legacy used
`createSupabaseServerClient()`) take `event: RequestEvent` as the FIRST parameter; public
functions take no event. Validators disappear — callers pass typed objects.

UI cards then expose them to components as remote functions in a co-located `*.remote.ts`:

```ts
// #features/chat/api/conversations.remote.ts
import { query, getRequestEvent } from '$app/server'
import * as conversations from '#features/chat/api/conversations.server.ts'

export const listConversations = query('batch', async (params: { limit?: number; offset?: number } = {}) =>
  conversations.listConversations(getRequestEvent(), params)
)
```

(`query('batch', ...)` / `command(...)` per kit/remote-functions docs — verify the exact
overload with `bunx @sveltejs/mcp get-documentation "kit/remote-functions"` when writing them.)

## 6. Framework mapping (TanStack Start → SvelteKit 3)

| Legacy | New |
|---|---|
| `createServerFn(GET)` read called from a route | plain async fn in `.server.ts`, called from `load` in `+page.server.ts` |
| `createServerFn(POST)` mutation called from a component event handler | **remote function** (`command`) in a `*.remote.ts` file — see kit/remote-functions docs |
| form submit (login/register) | **form action** in `+page.server.ts` + `use:enhance` |
| `createFileRoute('/x/$id')` | `src/routes/x/[id]/+page.svelte` (+ `+page.server.ts` for data) |
| `beforeLoad: requireAuth/requireAdmin` | in `+layout.server.ts`/`+page.server.ts`: `const s = await getSessionUser(event); if (!s) redirect(303, '/login?redirect=...')` |
| `redirect({ to })` thrown | `redirect(303, '/path')` from `@sveltejs/kit` |
| `createFileRoute('/api/x')` with `server.handlers` | `src/routes/api/x/+server.ts` exporting `GET`/`POST` |
| `useQuery` | `load` data via `data` prop, or remote `query()` for client-triggered reads |
| `useMutation` + `queryClient.invalidateQueries` | remote `command()` (single-flight refresh) or `refreshAll()` from `$app/navigation` |
| React `useState` | `let x = $state(...)` |
| React `useMemo` | `$derived(...)` / `$derived.by(...)` |
| React `useEffect` | avoid; event handlers, `$effect` only as last resort (never for derived values) |
| React context providers | `.svelte.ts` module class with `$state` fields + `createContext` from 'svelte' |
| `props.children` | `let { children } = $props()` + `{@render children?.()}` |
| `import.meta.env.SSR` / `typeof window` | `browser` from `$app/environment`… wait: **`$app/env`** in SvelteKit 3 |
| `useNavigate`/`Link`/`useParams` | `goto` from `$app/navigation`, plain `<a href>`, `page.params` from `$app/state` |

## 7. i18n

```ts
import * as m from '#paraglide/messages.js'
import { getLocale } from '#paraglide/runtime.js'
```
Message keys are identical to legacy (files copied verbatim). Keep key names; rename only if
legacy renamed them (match legacy `messages/en.json` exactly). Paraglide params:
`m.key({ name: value })` as in legacy call sites.

## 8. Tests

- Vitest, `*.test.ts` colocated, ported with imports rewritten. Keep assertions/behavior
  identical unless the legacy test asserted framework plumbing.
- Dexie/IndexedDB tests: add `import 'fake-indexeddb/auto'` at the top (legacy
  `test-setup.ts` handled this globally; make each test self-contained).
- Tests importing modules owned by another in-flight card may fail mid-wave; port them
  anyway and mark `deferred-integration` in evidence.
- React `*.test.tsx` files are NOT in scope for porting cards; UI cards own their rewrite.

## 9. Svelte code quality gate

After writing EVERY `.svelte` or `.svelte.ts` file:
`bunx @sveltejs/mcp svelte-autofixer <file>` → fix → repeat until zero issues.
Docs: `bunx @sveltejs/mcp list-sections`, `bunx @sveltejs/mcp get-documentation "<path>"`.
Use runes mode only (forced by config). No `on:click` (use `onclick`), no `<slot>` (use
snippets), no `export let` (use `$props`).

## 10. Acceptance & evidence

Your card lists runnable checks. General bar:
1. `bunx tsc --noEmit 2>&1` — zero errors in YOUR files. `Cannot find module '#…'` errors
   naming paths owned by another card in the same wave are tolerated mid-wave ONLY; list them.
2. `bunx vitest run <your test files>` — green (or marked deferred-integration per §8).
3. `bunx @sveltejs/mcp svelte-autofixer` — clean on every Svelte file you wrote.

Evidence file `migration/evidence/<NN>-<name>.md`:
```
# <Card name> — evidence
## Scope done          (files written, with one-line note each)
## Commands + outputs  (verbatim tail of each acceptance command)
## Deviations          (anything not 1:1, why)
## Cross-import debts  (missing modules from other cards, if any)
## TODOs               (@migration TODO list)
```

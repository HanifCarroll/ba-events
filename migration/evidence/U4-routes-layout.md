# Card U4 — routes + layout composition — evidence

## Scope done

| File | Note |
|---|---|
| `src/routes/+page.server.ts` | **NEW** — home route loader: `getTrendingEventsForGrid()` from `#features/events/api/crud.server.ts`, returns `{ trending }`. Replaces the legacy `index.tsx` loader (`getTrendingEventsAction`). |
| `src/routes/+page.svelte` | **REPLACED placeholder** — renders `<ChatPage />` (U1) exactly as legacy `index.tsx` composed `component: ChatPage` (no props). |
| `src/routes/chat/[conversationId]/+page.server.ts` | **NEW** — if `event.locals.user`, loads `getConversation(event, { id })` from `#features/chat/api/conversations.server.ts`; guests return `{ conversation: null }` (empty shell → client-side Dexie read in U1). `null` (not-found/foreign) is the faithful mapping — the legacy rendered `chat_conversation_not_found`, never `notFound()`/404. |
| `src/routes/chat/[conversationId]/+page.svelte` | **NEW** — renders `<ChatPage />` exactly as legacy `chat_.$conversationId.tsx` composed `component: ChatPage` (no props). |
| `src/routes/+layout.svelte` | **REPLACED S1 interim** — full root composition: auth init, PostHog init/identify (client-only `$effect`s), SEO/OG/Twitter/JSON-LD head, `EXCLUDED_ROUTES = ['/login', '/auth/callback']` bare-vs-`MainLayout` branch, `<Toaster position="bottom-right" richColors />`, `{@render children()}`. |
| `src/env.ts` | **EXTENDED (deviation)** — added `PUBLIC_POSTHOG_KEY` / `PUBLIC_POSTHOG_HOST` (`{ public: true }`) — required by the PostHog init, per CONTRACTS §3. |

`+layout.server.ts` left as S1 wrote it — no extension. The legacy `__root.tsx` `beforeLoad`
only loaded the session and performed locale sync; the locale sync already lives in
`src/hooks.server.ts` `handleLocaleSync` (S1). No addition needed.

## Commands + outputs

### 1. `bunx svelte-kit sync` (regenerates env + route types) — exit 0

Generated `node_modules/$app/types/env.d.ts` now declares (tail):

```
declare module '$app/env/public' {
	export const PUBLIC_SUPABASE_URL: string;
	export const PUBLIC_SUPABASE_ANON_KEY: string;
	export const PUBLIC_POSTHOG_KEY: string;
	export const PUBLIC_POSTHOG_HOST: string;
}
```

And `.svelte-kit/types/src/routes/chat/[conversationId]/$types.d.ts` was generated for the new route.

### 2. `bunx @sveltejs/mcp svelte-autofixer` — `issues: []` on every file written

```
src/routes/+page.svelte                        → { issues: [], suggestions: [], require_another_tool_call_after_fixing: false }
src/routes/chat/[conversationId]/+page.svelte  → { issues: [], suggestions: [], require_another_tool_call_after_fixing: false }
src/routes/+layout.svelte                      → { issues: [], suggestions: [12 advisory], require_another_tool_call_after_fixing: true }
```

The layout's 12 `suggestions` are advisory only (`issues` is empty — the gate). They are
false positives: 11 × "calling a function inside an `$effect`" (the bodies are imperative
side-effects — `import('posthog-js')`, `notifyPosthogReady`, `getAuthState`, `getLocale`,
`identify` — none assign stateful variables, so `$derived` does not apply; the tool itself
says "Ignore this suggestion if you are sure this function is not assigning any stateful
variable") and 1 × "Use SvelteSet instead" for `const posthogReadyCallbacks = new Set<() => void>()`
— this is a deliberately **non-reactive** callback registry (a faithful port of the legacy
`__root.tsx` `const posthogReadyCallbacks = new Set<() => void>()`); `SvelteSet` would make its
mutations reactive, which is explicitly unwanted here.

### 3. `bunx tsc --noEmit 2>&1` — zero errors in U4 files

All errors reported under `src/` (excluding the stale `build/` output) are in other in-flight
cards, not U4:

```
src/features/chat/components/message-scroll.test.ts(86,24): error TS2339: Property 'top' does not exist on type 'never'.
src/shared/hooks/pull-to-refresh.svelte.ts(48,9): error TS2322: Type '(container: HTMLElement) => () => void' is not assignable to type 'Attachment<Element>'.
```

`src/routes/+page.server.ts` and `src/routes/chat/[conversationId]/+page.server.ts` report **no**
errors (grep for `^src/routes/(+page.server|chat/)` → empty).

Note: `tsc` also reports 2945 errors under `build/_app/immutable/chunks/*.js`. That directory
is a stale `vite build` artifact (created 13:50 today, `.gitignore`d as `/build`); it is not
source, not in any card's scope, and is picked up only because the generated
`$app/tsconfig.json` has no `include`/`exclude`. Pre-existing, not caused by U4.

### 4. `bun run check` — U4 files have only the 3 tolerated cross-import errors

```
ERROR "src/routes/+layout.svelte" 10:25 "Cannot find module '#shared/ui/MainLayout.svelte' or its corresponding type declarations."
ERROR "src/routes/+page.svelte" 2:23 "Cannot find module '#features/chat/components/ChatPage.svelte' or its corresponding type declarations."
ERROR "src/routes/chat/[conversationId]/+page.svelte" 2:23 "Cannot find module '#features/chat/components/ChatPage.svelte' or its corresponding type declarations."
```

All three name modules owned by in-flight cards (U3 MainLayout, U1 ChatPage) — tolerated per
CONTRACTS §10. Every other `src/routes/*` error/warning in the run is in U2/U3 files
(`login`, `profile`, `saved`, `events/[id]`, `auth/callback`), not U4.

### 5. Forbidden-string grep → empty

```
$ grep -rn "@tanstack\|from 'react'\|import.meta.env" \
    src/routes/+layout.svelte src/routes/+page.svelte src/routes/+page.server.ts \
    "src/routes/chat/[conversationId]/+page.svelte" "src/routes/chat/[conversationId]/+page.server.ts" src/env.ts
(no output; exit 1)
```

### 6. `bun run test` (collateral check) — green

```
 Test Files  28 passed (28)
      Tests  194 passed (194)
   Duration  1.99s
```

## Deviations

1. **`src/env.ts` extended** (not in the card's file table). Card note 4 requires the PostHog
   init, which needs `PUBLIC_POSTHOG_KEY`/`PUBLIC_POSTHOG_HOST`; CONTRACTS §3 says new public
   vars go in `src/env.ts` (`{ public: true }`). Imported as **named exports** from
   `$app/env/public` — there is no `env` namespace object on `$env/static/public` in this RC
   (same finding S1 recorded); the card's `($env/static/public)` parenthetical is superseded
   by CONTRACTS §3 / S1's `$app/env/public` convention.
2. **No chat-state init call at root.** Card note 3 said "U1's `chat.svelte.ts` exposes the
   init". U1 actually implemented a **module singleton** (`export const chatState = new ChatState()`
   + `getChatState()`) with no `init`/`set` and no `createContext`. It self-initialises on
   first import, so there is no root wiring to do; I dropped the `initChatContext()` call and
   left a comment. If U1 later adds a context-based accessor, the layout would need a one-line
   init (noted in Cross-import debts).
3. **PostHogIdentify reads `getAuthState()`** (module singleton) rather than `useAuthContext()`.
   `useAuthContext()` is `createContext.get()` (init-time access); inside a reactive `$effect`
   the correct source is the `$state`-backed singleton, so `$effect` re-runs when
   `authState.user`/`authState.profile` change. Behavior is identical to the legacy
   `useAuthContext()` → `{ user, isAdmin }` inside `useEffect`.
4. **Home route has no client refetch.** Legacy `TrendingEvents` seeded its TanStack Query with
   the loader data and set `staleTime: 5 * 60 * 1000`; that refetch had no user-visible trigger
   on the home screen (no focus/interval invalidation), so it is dropped — per card note 1
   ("client refetch only if legacy had observable refetch behavior worth keeping").
5. **`bg-grain` body class dropped.** Legacy `<body className="bg-background text-foreground antialiased bg-grain">`.
   `bg-background text-foreground` + antialiasing are already applied by `src/app.css`
   `@layer base body { @apply bg-background text-foreground; }` + `-webkit-font-smoothing`; the
   remaining `bg-grain` is only `position: relative` (its comment says "grain effect removed
   for performance"). `src/app.html` (which owns `<body>`) is outside this card's scope, so I
   did not edit it and dropped the no-op remnant.
6. **`getSiteUrl()` canonical/OG URL.** The ported `#shared/lib/utils/url.ts` (an earlier card)
   already dropped the legacy `VITE_PUBLIC_SITE_URL` override, so SSR emits
   `https://baeventos.com` and the client emits `window.location.origin`. Inherited deviation,
   reproduced faithfully here.
7. **`/register` is NOT in `EXCLUDED_ROUTES`** (matches legacy `['/login', '/auth/callback']`
   exactly). U3 makes `register` a server-side redirect to `/login`, so it never visibly
   renders under `MainLayout`; the brief layout wrap during the redirect matches legacy (where
   register was also not excluded but redirected before rendering).
8. **`chat/[conversationId]` never 404s.** The legacy had no `notFound()` — it rendered the
   `chat_conversation_not_found` UI (with a "start new chat" link) inside `ChatContainer` for
   a missing/foreign conversation. I preserve that by returning `conversation: null` from
   `+page.server.ts` (no `error(404)`), matching the card's "preserve `chat_conversation_not_found`
   handling".

## Cross-import debts

- **`#shared/ui/MainLayout.svelte` (U3)** — not yet written; `+layout.svelte` imports it as
  the card maps `MainLayout.tsx → src/shared/ui/MainLayout.svelte`. Expected props: `{ children }`
  snippet (CONTRACTS §6), so I render `<MainLayout>{@render children()}</MainLayout>`.
- **`#features/chat/components/ChatPage.svelte` (U1)** — not yet written; both `+page.svelte`
  files import it per `ChatPage.tsx → src/features/chat/components/ChatPage.svelte`.
  **Contract assumption (documented so U1 can align):** `+page.svelte` renders `<ChatPage />`
  with **no props** (faithful to legacy `component: ChatPage`); `ChatPage.svelte` must read
  `page.params.conversationId` and `page.data` (`.trending` on home, `.conversation` on
  `chat/[conversationId]`) from `$app/state` — the Svelte mapping of the legacy
  `useParams({ strict: false })` / `useLoaderData({ strict: false })`.
- **`#features/chat/state/chat.svelte.ts` (U1)** — present but has **no init export**
  (`getChatState()`/`chatState` singleton). If U1 later adds a `createContext`-based
  `useChatContext()`/init, `+layout.svelte` should call that init (one line) in place of the
  current comment.

## TODOs

No `@migration TODO:` markers were left in U4 files. S1's
`@migration TODO: U4 composes layout` in `src/routes/+layout.svelte` is resolved by this card's
full layout replacement.

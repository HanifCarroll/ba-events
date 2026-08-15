# Card U4 — routes + layout composition

## Objective

Port the home and conversation routes, and compose the final root layout, per
`migration/CONTRACTS.md`.

## Scope (legacy base = /Users/hanifcarroll/projects/ba-events)

| Legacy | New |
|---|---|
| src/routes/index.tsx | src/routes/+page.server.ts + src/routes/+page.svelte (REPLACE the placeholder) |
| src/routes/chat_.$conversationId.tsx | src/routes/chat/[conversationId]/+page.server.ts + +page.svelte |
| src/routes/__root.tsx (composition only) | src/routes/+layout.svelte (REPLACE S1's interim version) |

`+layout.server.ts` stays as S1 wrote it — extend only if legacy root loaded more than
session data (check `beforeLoad`/loader); note any addition in evidence.

## Notes

1. **Home**: legacy loads trending events in the route loader (`getTrendingEventsAction`)
   and refetches via TanStack Query on the client. New: `+page.server.ts` load via
   `getTrendingEventsForGrid` from `#features/events/api/crud.server.ts`; the
   `TrendingEvents` component (U1) receives `data` — client refetch only if legacy had
   observable refetch behavior worth keeping (else note the simplification).
   Compose `ChatPage` (U1) exactly as legacy `index.tsx` does.
2. **chat/[conversationId]**: legacy loads a conversation with messages (authed) or falls
   back to the guest Dexie store client-side. `+page.server.ts`: if signed in, load via
   card-05 `getConversation`/messages fns; guests get an empty shell + client-side Dexie
   read (preserve `chat_conversation_not_found` handling and any `notFound()` →
   `error(404)` mapping).
3. **Root layout composition**: `EXCLUDED_ROUTES = ['/login', '/auth/callback']` — those
   render bare; everything else wraps in `MainLayout` (U3). Wire, in order:
   auth context init (S1's `initAuthContext(data)`), chat state provider if legacy had it
   at root (check `__root.tsx` — ChatProvider wrapped everything; U1's `chat.svelte.ts`
   exposes the init), PostHog client init (see below), skip link, and `{@render children()}`.
4. **PostHog init** (from `__root.tsx` PostHogInit/PostHogIdentify): client-only dynamic
   `import('posthog-js')`, init with `env.PUBLIC_POSTHOG_KEY` + `env.PUBLIC_POSTHOG_HOST`
   (`$env/static/public`), `posthog.identify` when auth user changes, locale in events is
   already handled by `track()`. Svelte: one `$effect` in the layout is fine and does NOT
   remount children (the legacy no-wrapper rationale doesn't apply to Svelte — keep the
   comment's intent noted). Also port the deferred-identify callback registration if
   legacy semantics require it.
5. Legacy `PwaRegister` is NOT ported: SvelteKit auto-registers `src/service-worker.ts`
   (card T1 owns the SW). Add nothing for PWA here.
6. Autofixer every `.svelte` until clean.

## Acceptance

1. Autofixer clean; `bunx tsc --noEmit` zero errors in your files.
2. `bun run check` whole-repo green modulo in-flight cards.
3. Forbidden-string grep → empty.

## Boundaries

No deps, no git, no dev server. No feature components (U1/U2/U3), no endpoints (A1),
no hooks.server.ts (S1 done).

## Evidence

`migration/evidence/U4-routes-layout.md` per CONTRACTS.md §10.

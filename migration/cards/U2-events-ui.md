# Card U2 — events-ui

## Objective

Port the events UI (cards, lists, save button) and the saved/profile/event-detail pages
from React to Svelte 5, per `migration/CONTRACTS.md`.

## Scope (legacy base = /Users/hanifcarroll/projects/ba-events)

| Legacy | New |
|---|---|
| src/routes/-components/events/EventCard.tsx | src/features/events/components/EventCard.svelte |
| src/routes/-components/events/EventList.tsx | src/features/events/components/EventList.svelte |
| src/routes/-components/SaveEventButton.tsx | src/features/events/components/SaveEventButton.svelte |
| (new) | src/features/events/api/saved.remote.ts |
| src/routes/-components/events/index.ts barrel | skip (note contents) |
| src/routes/saved.tsx | src/routes/saved/+page.svelte + +page.server.ts |
| src/routes/profile.tsx | src/routes/profile/+page.svelte + +page.server.ts |
| src/routes/events/$id.tsx | src/routes/events/[id]/+page.svelte + +page.server.ts |
| EventCard.test.tsx | logic-level vitest if extractable; else document drop |

## Notes

1. Read what `SaveEventButton` calls in legacy (save/unsave server paths — likely
   `#features/chat/api/user-tools.ts` or card-06's `saved.ts` TODO) and write
   `saved.remote.ts` `command` wrappers accordingly. Resolve card-06's
   `@migration TODO: wire remote function` in `chat/lib/saved.ts` if present — that wiring
   is yours.
2. Page data: `saved` and `profile` use `requireAuth(event)` from
   `#features/auth/api/session.server.ts` in `+page.server.ts`; event detail is public and
   uses `getEventWithVenueById` from `#features/events/api/crud.server.ts`.
3. Preserve legacy behavior on 404s (`events/[id]` → `error(404, ...)`), sign-in redirects
   (`/login?redirect=/saved`), toast + `track()` analytics calls, and the `usePullToRefresh`
   integration on `saved` IF legacy has it there (U3 owns the attachment — consume it).
4. Primitives from `#shared/ui/*` per card S2's evidence; icons `lucide-svelte`; i18n
   `#paraglide/messages.js`.
5. Profile page: display-name update + account deletion wire to S1's
   `profile-mutations.svelte.ts` / `auth.remote.ts`.

## Acceptance

1. Autofixer clean on every file; `bunx tsc --noEmit` zero errors in your files.
2. `bunx vitest run src/features/events` — green (including any logic test you extracted).
3. Forbidden-string grep (`@tanstack`, `from 'react'`, `import.meta.env`) → empty.

## Boundaries

No deps, no git, no dev server. No chat components (U1), no layout/auth pages (U3),
no home/chat routes (U4), no endpoints (A1).

## Evidence

`migration/evidence/U2-events-ui.md` per CONTRACTS.md §10.

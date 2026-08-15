# Card 06 — chat-lib + events

## Objective

Port the chat client-side logic modules and the events feature (presentation helpers +
public read functions) per `migration/CONTRACTS.md`.

## Scope (legacy base = /Users/hanifcarroll/projects/ba-events)

### `src/features/chat/lib/**` → same paths

- `extract-visible-text.ts` (+ .test.ts)
- `handoff-marks.ts` (+ .test.ts)
- `message-order.ts` (+ .test.ts)
- `message-timestamps.ts` (+ .test.ts)
- `messages.ts` (+ .test.ts)
- `persistence-outbox.ts` (+ .test.ts) — Dexie/IndexedDB, browser-only; test gets
  `import 'fake-indexeddb/auto'` at top (contract §8)
- `saved.ts`
- `speech-recognition.ts` — browser SpeechRecognition wrapper; keep plain `.ts`
- `title.ts` (+ .test.ts)

### `src/features/events/**` → same paths

| Legacy | New | Notes |
|---|---|---|
| api/crud.ts | api/crud.server.ts | drop `createServerFn`; `getTrendingEventsAction` → `getTrendingEventsForGrid`, `getEventWithVenueAction` → `getEventWithVenueById`; plain public async fns, no event param |
| lib/description-presentation.server.ts | same | already server-only |
| lib/description-presentation.ts (+ .test.ts) | same | |
| lib/location-presentation.ts (+ .test.ts) | same | |
| lib/source-presentation.ts (+ .test.ts) | same | |

`src/features/chat/index.ts`, `src/features/auth/index.ts`-style barrels: skip; if they
contain logic, note in evidence.

## Steps

1. Read CONTRACTS.md fully.
2. Port 1:1 per contract §2. `chat/lib` modules are imported by browser code — any
   `import.meta.env.VITE_*` becomes `$env/static/public` (contract §3); `@/paraglide/*`
   becomes `#paraglide/*.js`.
3. `saved.ts` — read it; if it calls server functions (save/unsave via `@/features/chat/api/...`),
   keep it calling the NEW `.server.ts` names only if they are isomorphic-safe; otherwise
   leave the call sites as typed function signatures and add `@migration TODO: wire remote
   function (UI wave)` — do NOT invent the remote wrapper yourself.
4. Tests: identical assertions, import-path changes only.

## Acceptance

1. `bunx tsc --noEmit 2>&1` — zero errors in your files except tolerated in-flight
   missing-module errors.
2. `bunx vitest run src/features/chat/lib src/features/events` — green (or
   deferred-integration notes).
3. `grep -rn "@tanstack\|from 'react'\|import.meta.env" src/features/chat/lib src/features/events` → empty.

## Boundaries

No deps, no git, no dev server. No `*.remote.ts` wrappers, no UI, no `chat/api/**` (card 05).

## Evidence

`migration/evidence/06-chat-lib-events.md` per CONTRACTS.md §10.

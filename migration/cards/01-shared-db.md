# Card 01 — shared-db

## Objective

Port the legacy data layer + server infrastructure modules to the SvelteKit repo,
framework-free, per `migration/CONTRACTS.md`.

## Scope (legacy → new; legacy base = /Users/hanifcarroll/projects/ba-events)

| Legacy file | New file |
|---|---|
| src/shared/lib/db/client.ts | src/shared/lib/db/client.server.ts |
| src/shared/lib/db/server.ts | src/shared/lib/db/server-client.server.ts |
| src/shared/lib/db/service.ts | src/shared/lib/db/service.server.ts |
| src/shared/lib/db/blocklist.ts | src/shared/lib/db/blocklist.ts |
| src/shared/lib/db/guest-conversations.ts | src/shared/lib/db/guest-conversations.ts |
| src/shared/lib/db/guest-conversations.test.ts | same |
| src/shared/lib/db/local-outbox.ts | src/shared/lib/db/local-outbox.ts |
| src/shared/lib/db/node-realtime.ts | src/shared/lib/db/node-realtime.ts |
| src/shared/lib/logger.ts | src/shared/lib/logger.ts |
| src/shared/lib/errors.ts | src/shared/lib/errors.ts |
| src/shared/lib/error-messages.ts | src/shared/lib/error-messages.ts |
| src/shared/lib/security.ts | src/shared/lib/security.ts |
| src/shared/lib/api-response.ts | src/shared/lib/api-response.ts |
| src/shared/lib/streaming-types.ts | src/shared/lib/streaming-types.ts |
| src/lib/analytics.ts | src/shared/lib/analytics.ts |
| src/lib/analytics.server.ts | src/shared/lib/analytics.server.ts |

NOT ported (deliberate): `src/lib/stubs/async-hooks.ts` (TanStack client-polyfill
workaround — SvelteKit server code runs in Node; if a port later needs it, it will flag it).

## Steps

1. Read CONTRACTS.md fully.
2. Read every legacy file in scope. Port 1:1 with import rewrites per contract §2.
3. `db/server.ts` — rewrite to the contract §5 canonical `createSupabaseServerClient(event)`
   signature. Deviation to note in evidence: the legacy `setAll` also forwarded
   `Cache-Control` headers from @supabase/ssr 0.12; SvelteKit does not CDN-cache dynamic
   responses, so this is dropped intentionally.
4. `analytics.ts` — its `getLocale` import becomes `#paraglide/runtime.js`.
5. `guest-conversations.test.ts` — add `import 'fake-indexeddb/auto'` at top (contract §8).
6. If any scoped file imports a module outside your scope that does not exist yet
   (e.g. `#shared/lib/types.ts` — card 02), keep the correct import path anyway; tolerate the
   transient error per contract §10.

## Acceptance

1. `bunx tsc --noEmit 2>&1` — zero errors in your new files except tolerated
   cannot-find-module errors pointing at card-02 paths.
2. `bunx vitest run src/shared/lib/db/` — green (or deferred-integration note).
3. No `@tanstack`, `react`, or `import.meta.env` strings anywhere in your files
   (verify: `grep -rn "@tanstack\|from 'react'\|import.meta.env" src/shared/lib`).

## Boundaries

Do NOT: install deps, run git, start dev servers, touch files outside the table above,
create `hooks.server.ts` or auth session helpers (card S1), port UI or routes.

## Evidence

Write `migration/evidence/01-shared-db.md` per CONTRACTS.md §10.

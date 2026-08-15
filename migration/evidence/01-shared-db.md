# Card 01 — shared-db — evidence

## Scope done

| New file | Note |
|---|---|
| `src/shared/lib/db/client.server.ts` | Ported 1:1 from `db/client.ts`; import rewrites only (`type SupabaseClient` modifier, `../constants.ts`, `../types.ts`, `../ai/embeddings.ts`, `../search/rrf.ts`, `./node-realtime.ts`). `process.env.SUPABASE_URL`/`SUPABASE_ANON_KEY` kept. |
| `src/shared/lib/db/server-client.server.ts` | `db/server.ts` rewritten to contract §5 canonical `createSupabaseServerClient(event: RequestEvent)` using `event.cookies`. |
| `src/shared/lib/db/service.server.ts` | Ported 1:1 from `db/service.ts`; `./node-realtime.ts` import. |
| `src/shared/lib/db/blocklist.ts` | Ported 1:1; `./client.ts` → `./client.server.ts`, `../types` → `../types.ts`. |
| `src/shared/lib/db/guest-conversations.ts` | Ported 1:1; `@/shared/lib/types` → `#shared/lib/types.ts`. |
| `src/shared/lib/db/guest-conversations.test.ts` | Ported with identical assertions; added `import 'fake-indexeddb/auto'` at top (contract §8); `./guest-conversations.ts`. |
| `src/shared/lib/db/local-outbox.ts` | Ported 1:1; `@/shared/lib/types` → `#shared/lib/types.ts`. |
| `src/shared/lib/db/node-realtime.ts` | Ported verbatim (no import changes). |
| `src/shared/lib/logger.ts` | Ported verbatim; only the doc-comment example import path updated (`@/shared/lib/logger` → `#shared/lib/logger.ts`). |
| `src/shared/lib/errors.ts` | Ported verbatim. |
| `src/shared/lib/error-messages.ts` | Ported verbatim. |
| `src/shared/lib/security.ts` | Ported verbatim. |
| `src/shared/lib/api-response.ts` | Ported verbatim. |
| `src/shared/lib/streaming-types.ts` | Ported verbatim. |
| `src/shared/lib/analytics.ts` | `@/paraglide/runtime` → `#paraglide/runtime.js`; `typeof window === 'undefined'` guards → `browser` from `$app/env` (contract §6). |
| `src/shared/lib/analytics.server.ts` | `./analytics` → `./analytics.ts`; `process.env.VITE_PUBLIC_POSTHOG_KEY` → `process.env.PUBLIC_POSTHOG_KEY` (env rename, contract §3). |

Not ported (deliberate, per card): `src/lib/stubs/async-hooks.ts`.

## Commands + outputs

### `bunx tsc --noEmit` (exit 2)

```
src/shared/lib/ai/embeddings.ts(4,58): error TS2307: Cannot find module '../types.ts' or its corresponding type declarations.
src/shared/lib/ai/embeddings.ts(6,34): error TS2307: Cannot find module '#shared/lib/search-facets.ts' or its corresponding type declarations.
src/shared/lib/ai/embeddings.ts(7,30): error TS2307: Cannot find module '#shared/lib/search-facets.ts' or its corresponding type declarations.
src/shared/lib/db/blocklist.ts(12,8): error TS2307: Cannot find module '../types.ts' or its corresponding type declarations.
src/shared/lib/db/client.server.ts(8,29): error TS2307: Cannot find module '../constants.ts' or its corresponding type declarations.
src/shared/lib/db/client.server.ts(18,8): error TS2307: Cannot find module '../types.ts' or its corresponding type declarations.
src/shared/lib/db/client.server.ts(20,25): error TS2307: Cannot find module '../search/rrf.ts' or its corresponding type declarations.
src/shared/lib/db/guest-conversations.ts(6,8): error TS2307: Cannot find module '#shared/lib/types.ts' or its corresponding type declarations.
src/shared/lib/db/local-outbox.ts(6,8): error TS2307: Cannot find module '#shared/lib/types.ts' or its corresponding type declarations.
```

My files account for the 6 errors below the `ai/embeddings.ts` lines; all are tolerated
cannot-find-module errors pointing at card-02 paths (`types.ts`, `constants.ts`,
`search/rrf.ts`). The 3 `ai/embeddings.ts` errors belong to card 02 (in-flight, same wave).
Zero errors otherwise.

### `bunx vitest run src/shared/lib/db/` (exit 0)

```
 RUN  v4.1.10 /Users/hanifcarroll/projects/ba-events-sveltekit


 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  12:45:13
   Duration  220ms (transform 20ms, setup 0ms, import 72ms, tests 37ms, environment 0ms)
```

### forbidden-string grep (exit 1 = no matches)

```
$ grep -rn "@tanstack\|from 'react'\|import.meta.env" src/shared/lib
(no output)
```

### leftover `@/` alias grep (exit 1 = no matches)

```
$ grep -rn "@/shared\|@/paraglide\|@/lib/" src/shared/lib
(no output)
```

## Deviations

- **`server-client.server.ts` dropped the `Cache-Control` forwarding** from the legacy
  `setAll(cookies, headers)` (@supabase/ssr 0.12). SvelteKit does not CDN-cache dynamic
  responses, so the header forwarding is intentionally dropped per card step 3. The
  `secure: process.env.NODE_ENV === 'production'` flag from legacy is also gone (SvelteKit
  cookie `options` already carry `secure` when set by the SSR cookie layer).
- **`analytics.server.ts` env var rename**: `process.env.VITE_PUBLIC_POSTHOG_KEY` →
  `process.env.PUBLIC_POSTHOG_KEY`. This is the §3 rename `VITE_PUBLIC_POSTHOG_KEY→PUBLIC_POSTHOG_KEY`;
  the repo's `.env` now provisions `PUBLIC_POSTHOG_KEY` (no `VITE_` prefix). Kept as
  `process.env` (server-side rule), only the variable name changed to preserve behavior.
- **`analytics.ts` SSR guard**: `typeof window === 'undefined'` → `browser` from `$app/env`
  (contract §6 framework mapping). Behavior identical (no-op during SSR).
- **`client.server.ts` type import**: `import { createClient, SupabaseClient }` →
  `import { createClient, type SupabaseClient }` to satisfy `verbatimModuleSyntax`/strict
  (type-only usage). No runtime behavior change.
- **`blocklist.ts` client import kept relative** (`./client.server.ts`) rather than the
  `#shared/lib/db/client.server.ts` alias form. Contract §2 says colocated files keep
  relative imports; the legacy file used `./client`. Both resolve to the same module. Noted
  in case a later reviewer expects the alias form (§4's "all import sites" parenthetical).

## Cross-import debts

- `src/shared/lib/types.ts` — card 02 (imported by `blocklist.ts`, `client.server.ts`,
  `guest-conversations.ts`, `local-outbox.ts`). Does not exist yet.
- `src/shared/lib/constants.ts` — card 02 (imported by `client.server.ts`). Does not exist yet.
- `src/shared/lib/search/rrf.ts` — card 02 (imported by `client.server.ts`). Does not exist yet.
- `src/shared/lib/ai/embeddings.ts` — card 02; already present in-tree (in-flight worker),
  resolves cleanly from `client.server.ts`.

## TODOs

None. No `@migration TODO:` annotations were required.

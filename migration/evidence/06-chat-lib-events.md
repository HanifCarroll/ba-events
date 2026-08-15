# Card 06 — chat-lib + events — evidence

## Scope done

| New file | Note |
|---|---|
| `src/features/chat/lib/extract-visible-text.ts` | verbatim (no imports) |
| `src/features/chat/lib/extract-visible-text.test.ts` | `./extract-visible-text` → `./extract-visible-text.ts`; assertions unchanged |
| `src/features/chat/lib/handoff-marks.ts` | verbatim (no imports) |
| `src/features/chat/lib/handoff-marks.test.ts` | `./handoff-marks` → `./handoff-marks.ts`; assertions unchanged |
| `src/features/chat/lib/message-order.ts` | `@/shared/lib/types` → `#shared/lib/types.ts` |
| `src/features/chat/lib/message-order.test.ts` | `./message-order` → `./message-order.ts`; assertions unchanged |
| `src/features/chat/lib/message-timestamps.ts` | verbatim (no imports) |
| `src/features/chat/lib/message-timestamps.test.ts` | `./message-timestamps` → `./message-timestamps.ts`; assertions unchanged |
| `src/features/chat/lib/messages.ts` | `@/shared/lib/types` → `#shared/lib/types.ts`, `@/shared/lib/constants` → `#shared/lib/constants.ts`, `@/paraglide/messages` → `#paraglide/messages.js` |
| `src/features/chat/lib/messages.test.ts` | `@/paraglide/messages` → `#paraglide/messages.js`, `@/features/chat/lib/messages` → `#features/chat/lib/messages.ts`; assertions unchanged |
| `src/features/chat/lib/persistence-outbox.ts` | `@/shared/lib/db/local-outbox` → `#shared/lib/db/local-outbox.ts`, `@/shared/lib/types` → `#shared/lib/types.ts` |
| `src/features/chat/lib/persistence-outbox.test.ts` | added `import 'fake-indexeddb/auto'` at top (card + §8); `./persistence-outbox` → `./persistence-outbox.ts`; `vi.mock('@/shared/lib/db/local-outbox', …)` → `vi.mock('#shared/lib/db/local-outbox.ts', …)`; assertions unchanged |
| `src/features/chat/lib/saved.ts` | `@/features/auth/api/client` → `#features/auth/api/client.ts`, `@/shared/lib/types` → `#shared/lib/types.ts`; see Deviations (removed `as any`, `typeof window` → `browser`) |
| `src/features/chat/lib/speech-recognition.ts` | verbatim except `typeof window === 'undefined'` → `browser` from `$app/env` (§6) |
| `src/features/chat/lib/title.ts` | verbatim (no imports) |
| `src/features/chat/lib/title.test.ts` | `./title` → `./title.ts`; assertions unchanged (dropped one trailing blank line, cosmetic) |
| `src/features/events/api/crud.server.ts` | `api/crud.ts` → `api/crud.server.ts`; dropped `createServerFn`; `getTrendingEventsAction` → `getTrendingEventsForGrid`, `getEventWithVenueAction` → `getEventWithVenueById`; plain public async fns, no event param; `@/shared/lib/db/client` → `#shared/lib/db/client.server.ts` |
| `src/features/events/lib/description-presentation.server.ts` | `@/shared/lib/ai/enrichment` → `#shared/lib/ai/enrichment.ts`, `./description-presentation` → `./description-presentation.ts` |
| `src/features/events/lib/description-presentation.ts` | `@/shared/lib/types` → `#shared/lib/types.ts` |
| `src/features/events/lib/description-presentation.test.ts` | `./description-presentation` → `./description-presentation.ts`; assertions unchanged |
| `src/features/events/lib/location-presentation.ts` | verbatim (no imports) |
| `src/features/events/lib/location-presentation.test.ts` | `./location-presentation` → `./location-presentation.ts`; assertions unchanged |
| `src/features/events/lib/source-presentation.ts` | `@/paraglide/messages` → `#paraglide/messages.js` |
| `src/features/events/lib/source-presentation.test.ts` | `./source-presentation` → `./source-presentation.ts`; assertions unchanged |

Barrels: legacy `src/features/chat/index.ts` and `src/features/auth/index.ts` are pure
re-export barrels (no logic) — skipped per card. `src/features/events` has no barrel.

## Commands + outputs

### 1. `bunx tsc --noEmit 2>&1` (exit 2)

```
src/features/chat/lib/saved.ts(2,42): error TS2307: Cannot find module '#features/auth/api/client.ts' or its corresponding type declarations.
src/shared/lib/types.ts(1,40): error TS2307: Cannot find module '#features/chat/api/tools/search-events.ts' or its corresponding type declarations.
```

Both are tolerated cross-card `cannot-find-module` errors (see Cross-import debts).
`#features/auth/api/client.ts` is owned by card **S1-auth-shell** (imported only by my
`saved.ts`); `#features/chat/api/tools/search-events.ts` is a pre-existing debt from card 02
(owned by card **05 chat-api**), in `src/shared/lib/types.ts` — not a file I wrote. Zero
errors otherwise.

### 2. `bunx vitest run src/features/chat/lib src/features/events` (exit 0)

```
 RUN  v4.1.10 /Users/hanifcarroll/projects/ba-events-sveltekit


 Test Files  10 passed (10)
      Tests  47 passed (47)
   Start at  12:57:19
   Duration  296ms (transform 347ms, setup 0ms, import 542ms, tests 48ms, environment 2ms)
```

Full suite (`bunx vitest run`) also green: **20 files, 106 tests passed** (exit 0).

### 3. `grep -rn "@tanstack\|from 'react'\|import.meta.env" src/features/chat/lib src/features/events` (exit 1 = no matches)

```
(no output)
```

## Deviations

1. **`saved.ts` — removed all `as any` casts / `any` params** (contract §1 "no any").
   The legacy file used `(client.from('saved_events').select(...) as any)` plus
   `mapSavedEventRow(item: any)` and `(item: any) => item.event_id`. The browser Supabase
   client is untyped (`SupabaseClient` default `any` database), so the casts were
   unnecessary; I dropped them and typed the query rows with local interfaces
   (`SavedEventRow` = `{ created_at, events: (Event & { venues: Venue | null }) | null }`,
   `SavedEventIdRow` = `{ event_id: string }`). Runtime behavior is identical — the nested
   `events (*, venues (*))` select shape and the `mapSavedEventRow` transform
   (`{...event, venue_name/address/neighborhood, saved_at}`) are preserved verbatim,
   including the spread of the nested `venues` object onto the result.
   - **`typeof window === 'undefined'` → `browser` from `$app/env`** (§6) in
     `dispatchSavedEventsChanged`.
   - **Card step 3 conditional does not apply**: `saved.ts` does NOT call
     `@/features/chat/api/*` server functions — it queries Supabase directly through the
     browser client. So no remote wrapper or `@migration TODO` was needed; the call sites
     (`getSupabaseBrowserClient`) stay as typed function calls against the S1 auth client.
2. **`speech-recognition.ts` — `typeof window === 'undefined'` → `browser` from `$app/env`**
   (§6 framework mapping, matching card-01's `analytics.ts`/`url.ts` pattern). Behavior
   identical (SSR → null/unsupported; browser → window lookup).
3. **`persistence-outbox.test.ts`** — added `import 'fake-indexeddb/auto'` at top per card
   note + §8, even though the test `vi.mock`s the whole local-outbox module (so no real
   IndexedDB is touched). Defensive/harmless; the legacy global `test-setup.ts` is gone and
   each test is now self-contained.
4. **`title.test.ts`** — dropped a single trailing blank line that existed in the legacy
   file (pure whitespace, no assertion or behavior change).
5. **`crud.server.ts`** — the `createServerFn` wrappers are gone by design (card + §5/§6):
   `getTrendingEventsForGrid(): Promise<ChatEventPayload[]>` and
   `getEventWithVenueById(id: string)` are plain public async functions. The legacy
   `getEventWithVenueAction` had no explicit return annotation, so `getEventWithVenueById`
   keeps it inferred (`Promise<EventWithVenue>` via `getEventWithVenue`) rather than adding
   a new annotation.

## Cross-import debts

- `#features/auth/api/client.ts` (imported by `src/features/chat/lib/saved.ts`) — owned by
  card **S1-auth-shell**; not yet present. Tolerated per §10.
- `#features/chat/api/tools/search-events.ts` (imported by `src/shared/lib/types.ts`) —
  owned by card **05 chat-api**; pre-existing debt from card 02, not created by this card.

## TODOs

None. No `@migration TODO:` annotations were required.

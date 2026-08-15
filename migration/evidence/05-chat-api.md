# Card 05 — chat-api — evidence

## Scope done

All files live under `src/features/chat/api/**`, mirroring the legacy
`src/features/chat/api/**` (vertical slice preserved). Import aliases rewritten
per CONTRACTS.md §2, relative imports carry explicit `.ts` extensions, and every
`createServerFn` was converted to a plain exported async function per §5/§6.

| File | Note |
|---|---|
| `stream-helpers.ts` | Extracted the pure helpers + private deps from the legacy `src/routes/api/chat.ts` (`buildExecutionTrace`, `getFinalVisibleTextFromSteps`, `sanitizeFinalAssistantText`, `filterEventsMentionedInText`, `normalizeForNameMatch`, `META_NARRATION_PATTERN`, `toJsonSafe`, `inferToolResultSuccess`, `normalizeStepType`, `getNonEmptyStepTextCount`, `getLastUserQuery`, `buildStreamEnvelope`, `StepResultLike`, `MAX_STEPS`). All exported so card A1's handler can import them. |
| `conversations.server.ts` | 6 `createServerFn` → plain async fns, `event: RequestEvent` first param; `#shared/lib/db/server-client.server.ts`. |
| `messages.server.ts` | 3 `createServerFn` → plain async fns, `event` first param. |
| `generate-title.server.ts` | `generateConversationTitle`/`generateTitle` public (no auth); `generateAndSaveTitle(event, …)` user-scoped. |
| `suggestions.ts` | Kept as-is (no `createServerFn`); imports retargeted. |
| `topic-guard.ts` | Kept as-is; imports retargeted. |
| `topic-guard.test.ts` | Verbatim (only added `.ts` extension to the relative import). |
| `user-tools.server.ts` | Renamed to `.server.ts` (imports session/client/server-client `.server` modules). Threaded `event` through `UserToolContext`; removed two `any` casts. |
| `tools-ai-sdk.ts` | Imports retargeted (`./user-tools.server.ts`, tools with `.ts` ext). |
| `prompts/concierge.ts` | Verbatim. |
| `prompts/index.ts` | Verbatim (`.ts` ext on relative import). |
| `tools/types.ts` | Imports retargeted. |
| `tools/utils.ts` | Imports retargeted. |
| `tools/check-event-saved.ts` | Imports retargeted. |
| `tools/coverage-guard.ts` | Imports retargeted. |
| `tools/coverage-guard.test.ts` | Verbatim (`.ts` ext). |
| `tools/get-directions.ts` | Imports retargeted. |
| `tools/get-event-details.ts` | Imports retargeted. |
| `tools/get-venue-details.ts` | Imports retargeted. |
| `tools/list-saved-events.ts` | Imports retargeted. |
| `tools/quality-diversity.ts` | Imports retargeted. |
| `tools/save-event.ts` | Imports retargeted. |
| `tools/search-events.ts` | Imports retargeted (`db/client.server.ts`, logger, etc.). |
| `tools/search-events.test.ts` | Imports + `vi.mock` retargeted to `#shared/lib/db/client.server.ts`; assertions unchanged. |
| `tools/search-intent.ts` | Imports retargeted. |
| `tools/search-intent.test.ts` | Imports + `vi.mock` retargeted; assertions unchanged. |
| `tools/unsave-event.ts` | Imports retargeted. |
| `chat-contract.test.ts` | `@/routes/api/chat` → `#features/chat/api/stream-helpers.ts`; assertions unchanged. |

Out of scope and NOT touched: `chat/lib/**` (card 06), `chat/hooks/**` (UI wave),
`src/routes/api/chat.ts` handler (card A1), `*.remote.ts` wrappers (UI wave).

## Commands + outputs

### 1. `bunx tsc --noEmit 2>&1`

```
src/features/chat/api/user-tools.server.ts(15,32): error TS2307: Cannot find module '#features/auth/api/session.server.ts' or its corresponding type declarations.
src/features/chat/lib/saved.ts(2,42): error TS2307: Cannot find module '#features/auth/api/client.ts' or its corresponding type declarations.
```

Zero errors in files owned by this card. Both errors are in-flight
missing-module errors from other cards (§10 tolerated):
- `#features/auth/api/session.server.ts` is the S1 shell card's `getSessionUser`
  module, imported by my `user-tools.server.ts`.
- `#features/chat/lib/saved.ts` is card 06's file importing `#features/auth/api/client.ts`.

### 2. `bunx vitest run src/features/chat/api`

```
 RUN  v4.1.10 /Users/hanifcarroll/projects/ba-events-sveltekit

 Test Files  5 passed (5)
      Tests  78 passed (78)
   Start at  13:04:05
   Duration  1.06s (transform 434ms, setup 0ms, import 3.84s, tests 38ms, environment 1ms)
```

5 test files, 78 tests, all green (no deferred-integration needed — the
concurrent card 06 had landed `chat/lib/{message-order,title,extract-visible-text}.ts`
and the events card had landed `events/lib/description-presentation.ts` before
the run).

### 3. forbidden-imports grep

`grep -rn "@tanstack\|from 'react'\|import.meta.env" src/features/chat/api` → empty
(exit 1 = no matches). Also verified no `@/`-prefixed imports and no extension-less
relative imports remain in `src/features/chat/api`.

## Deviations

1. **`user-tools.ts` → `user-tools.server.ts`.** Judged by its imports (per card
   table): it reads the session (`getSessionUser`) and builds a cookie-bound
   Supabase client, so it is server-only. `getUserToolContext` now takes
   `event: RequestEvent`, and `UserToolContext` gained an optional
   `event?: RequestEvent` field so the user-scoped helpers
   (`saveEventForUser`, `unsaveEventForUser`, `listSavedEventsForUser`,
   `checkEventSavedForUser`) can build `createSupabaseServerClient(ctx.event)`.
   The optional field keeps the search-events test's bare
   `{ userId: null, isAuthenticated: false }` context literal type-valid.
2. **Removed two `any` casts** in `listSavedEventsForUser` (`.map((item: any)…)`
   / `.filter((event: any)…)`) and replaced with a typed `SavedEventRow` +
   `event is EventWithVenue` type guard. Contract hard rule: no `any`. Behavior
   unchanged.
3. **Dynamic `await import('@/shared/lib/db/server')` → static**
   `import { createSupabaseServerClient } from '#shared/lib/db/server-client.server.ts'`.
   The dynamic import was a TanStack idiom; the canonical SvelteKit server-client
   is statically imported. Behavior identical.
4. **`stream-helpers.ts` exports its private dependencies too** (`toJsonSafe`,
   `inferToolResultSuccess`, `normalizeStepType`, `getLastUserQuery`,
   `getNonEmptyStepTextCount`, `META_NARRATION_PATTERN`, `normalizeForNameMatch`,
   `buildStreamEnvelope`, `MAX_STEPS`). In the legacy route these were
   module-private, but card A1's handler calls them directly, so they must be
   importable. The five originally-exported names keep identical signatures.
5. **`listConversations` keeps `search?: string`** in its params type even though
   the legacy handler never read it — the legacy validator accepted it, so the
   signature is preserved for future callers.
6. **`generateTitle` / `generateConversationTitle` take no event** — they perform
   no auth and no DB work, so per §5 they are public functions;
   `generateAndSaveTitle` is user-scoped and takes `event`.
7. **`tools/*.ts` import `.server.ts` modules** (`#shared/lib/db/client.server.ts`,
   `../user-tools.server.ts`) while keeping their own plain `.ts` paths, exactly
   as the card table instructs ("same paths"). This is only ever reachable from
   the chat route (server code) and is outside the tsc/vitest acceptance gates;
   flagged here in case the build wave wants to revisit SvelteKit's static
   `.server`-import check.

## Cross-import debts

- `#features/auth/api/session.server.ts` (S1 shell card) — imported by
  `user-tools.server.ts`; still missing at evidence time → 1 tolerated tsc error.
- `#features/chat/lib/saved.ts` (card 06) imports `#features/auth/api/client.ts`
  (auth card) — appears in the tsc output but is not a file owned by this card.
- Resolved mid-wave by concurrent cards (were missing when this card started):
  `#features/chat/lib/{message-order,title,extract-visible-text}.ts` (card 06) and
  `#features/events/lib/description-presentation.ts` (events card).

## TODOs

None.

# Card 05 — chat-api

## Objective

Port the chat concierge backend (agent tools, prompts, persistence, title generation, topic
guard) and extract the streaming helpers out of the legacy API route, per
`migration/CONTRACTS.md`.

## Scope (legacy base = /Users/hanifcarroll/projects/ba-events)

`src/features/chat/api/**` → same paths, with conversions per contract §5/§6:

| Legacy | New | Notes |
|---|---|---|
| conversations.ts | conversations.server.ts | 6 `createServerFn` → plain async fns, `event: RequestEvent` first param (all user-scoped) |
| messages.ts | messages.server.ts | same conversion |
| generate-title.ts | generate-title.server.ts | same conversion |
| suggestions.ts | suggestions.ts | keep as-is unless it imports createServerFn — then `.server.ts` |
| topic-guard.ts (+ .test.ts) | same paths | |
| user-tools.ts | user-tools.ts or .server.ts | judge by its imports |
| tools-ai-sdk.ts | same | |
| prompts/concierge.ts, prompts/index.ts | same paths | prompts/index.ts: port only if it holds logic; if barrel, skip + note |
| tools/*.ts (all 14 + types + utils) | same paths | `check-event-saved, coverage-guard(+test), get-directions, get-event-details, get-venue-details, list-saved-events, quality-diversity, save-event, search-events(+test), search-intent(+test), types, unsave-event, utils` |
| chat-contract.test.ts | same path | import retarget, see step 3 |

Plus the extraction:

| Legacy | New |
|---|---|
| src/routes/api/chat.ts — ONLY the exported pure helpers and their private dependencies (`buildExecutionTrace`, `getFinalVisibleTextFromSteps`, `sanitizeFinalAssistantText`, `filterEventsMentionedInText`, `normalizeForNameMatch`, `META_NARRATION_PATTERN`, `toJsonSafe`, `inferToolResultSuccess`, `normalizeStepType`, `getNonEmptyStepTextCount`, `getLastUserQuery`, `buildStreamEnvelope`, `StepResultLike`, `MAX_STEPS`) | src/features/chat/api/stream-helpers.ts |

The endpoint handler itself (streamText wiring, rate limiting, request parsing) is NOT
yours — card A1 ports it later and will import your `stream-helpers.ts`.

## Steps

1. Read CONTRACTS.md fully.
2. Port each file. `createServerFn` conversions follow contract §5 "Data functions vs
   remote wrappers" — `.server.ts`, `event` first param, validators become typed params.
   Keep every exported name identical (callers are ported later against these names).
3. `chat-contract.test.ts`: retarget its `@/routes/api/chat` import to
   `#features/chat/api/stream-helpers.ts`. Assertions unchanged.
4. Tools importing analytics: `@/lib/analytics.server` → `#shared/lib/analytics.server.ts`.
5. Tools importing events modules (`#features/events/api/crud.server.ts` — card 06, same
   wave): use the real path; tolerate transient missing-module errors per contract §10.
6. Tests: port all `*.test.ts` in scope with identical assertions.

## Acceptance

1. `bunx tsc --noEmit 2>&1` — zero errors in your files except tolerated in-flight
   missing-module errors.
2. `bunx vitest run src/features/chat/api` — green (or deferred-integration notes).
3. `grep -rn "@tanstack\|from 'react'\|import.meta.env" src/features/chat/api` → empty.

## Boundaries

No deps, no git, no dev server. Do NOT write `*.remote.ts` wrappers (UI wave), do NOT port
`src/routes/api/chat.ts`'s handler (card A1), do NOT touch `chat/lib/**` (card 06) or
`chat/hooks/**` (UI wave).

## Evidence

`migration/evidence/05-chat-api.md` per CONTRACTS.md §10.

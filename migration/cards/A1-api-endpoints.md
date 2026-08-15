# Card A1 — api-endpoints

## Objective

Port the two HTTP endpoints — the chat streaming endpoint and the public events API —
to SvelteKit `+server.ts` routes, per `migration/CONTRACTS.md`.

## Scope (legacy base = /Users/hanifcarroll/projects/ba-events)

| Legacy | New |
|---|---|
| src/routes/api/chat.ts (handler only) | src/routes/api/chat/+server.ts |
| src/routes/api/events.ts | src/routes/api/events/+server.ts |

Already available (ported): pure helpers in `#features/chat/api/stream-helpers.ts`
(card 05), agent tools in `#features/chat/api/tools-ai-sdk.ts` + `user-tools.ts`,
persistence fns in `#features/chat/api/{conversations,messages}.server.ts`, rate limiting
in `#features/auth/api/rate-limit.server.ts` (S1 — read its evidence for exact signatures),
`api-response.ts` helpers (card 01), `embeddings.ts`, `description-presentation.server.ts`.

## Notes

1. **chat/+server.ts** — `export const POST: RequestHandler`. Port the legacy handler 1:1:
   request parsing, guest/auth branching, rate limit (`getClientIP` + scoped checks),
   `streamText({ model: textModel, ...NO_THINKING })` with the same tools + `MAX_STEPS`,
   step-finish/envelope logic from `stream-helpers.ts`, assistant-message persistence,
   `trackServer` analytics, and the EXACT legacy wire format (`ChatStreamDataEnvelope`
   data parts, `createErrorStream`, `createRateLimitResponse`). The client (card U1) is
   built against this format — do not improvise. Legacy used
   `createFileRoute(...).server.handlers.POST` receiving a web `Request`; return web
   `Response` objects (SvelteKit accepts them directly).
   AI SDK v7 stream-to-Response: check the installed `ai` package
   (`node_modules/ai/README.md` / dist types) for `toUIMessageStreamResponse` /
   `toDataStreamResponse` and custom data parts; match whichever the legacy route used.
2. **events/+server.ts** — port both handlers (GET list with cache presets via `withCache`,
   POST create with `ADMIN_API_KEY` bearer check, zod `eventSubmissionSchema`, rate limit,
   `embedEventWithDocument`, description presentation fields). Keep `process.env` reads.
3. SvelteKit 3 note: routes resolve strictly; `RequestEvent` gives `request`, `cookies`,
   `setHeaders`, `getClientAddress`. Use `event.getClientAddress()` with the legacy
   header-parsing fallback preserved (legacy parsed x-forwarded-for — keep that order).
4. No `.svelte` files in this card.

## Acceptance

1. `bunx tsc --noEmit` — zero errors in your files.
2. `bunx vitest run src/features/chat/api/chat-contract.test.ts` — still green against
   your wiring (it tests stream-helpers; confirm no import breakage).
3. `grep -rn "@tanstack\|from 'react'" src/routes/api` → empty.
4. `bun run build` compiles the server bundle without errors in your routes (run it;
   other in-flight route errors, if any, are not yours — report them).

## Boundaries

No deps, no git, no dev server. Only `src/routes/api/**`. Do not modify stream-helpers or
feature modules — if a signature blocks you, stop and document it in evidence.

## Evidence

`migration/evidence/A1-api-endpoints.md` per CONTRACTS.md §10. Must include the AI SDK
response-builder you used and a byte-level description of the stream envelope.

# A1 — api-endpoints — evidence

## Scope done

| File | Note |
|---|---|
| `src/routes/api/chat/+server.ts` | Ported the legacy `src/routes/api/chat.ts` `POST` handler 1:1 into a SvelteKit `+server.ts` `POST` export. `getUserToolContext()` → `getUserToolContext(event)`, `getClientIP(request)` → `getClientIP(event)` (see deviations), imports rewritten to `#…` aliases with `.ts` extensions. All stream/guard/trace logic, tool accumulation, `trackServer` calls, and the exact `ChatStreamDataEnvelope` wire parts preserved. |
| `src/routes/api/events/+server.ts` | Ported both `GET` (list + `withCache` short preset) and `POST` (create: `ADMIN_API_KEY` bearer check, zod `eventSubmissionSchema`, `embedEventWithDocument`, `buildDescriptionPresentationFields`, `createEvent`) handlers into `GET`/`POST` exports. `process.env` reads kept; `getClientIP`/`applyRateLimit` now take `RequestEvent`. |

No `.svelte`/`.svelte.ts` files in this card, so the autofixer gate (§9) is N/A.

## AI SDK response builder used

The route uses the AI SDK **v7** UI-message-stream pair (the exact builder the legacy
route used — legacy `ai@7.0.59`, this repo `ai@7.0.66`):

- `createUIMessageStream({ execute, onError })` → `ReadableStream<InferUIMessageChunk<UIMessage>>`
- `createUIMessageStreamResponse({ stream, headers: { 'Cache-Control': 'no-cache' } })` → web `Response`

SvelteKit accepts the returned web `Response` directly from the `POST` handler. No
`toUIMessageStreamResponse`/`toDataStreamResponse`; the legacy used
`createUIMessageStreamResponse`, so that is what was kept.

## Byte-level stream envelope

`createUIMessageStreamResponse` pipes the chunk stream through the AI SDK
`JsonToSseTransformStream`. Every chunk is a Server-Sent Events record:

```
data: <JSON.stringify(chunk)>\n\n
```

and the stream flushes a terminal record:

```
data: [DONE]\n\n
```

Response headers come from the SDK defaults (`UI_MESSAGE_STREAM_HEADERS`) merged with our
`Cache-Control: no-cache`: `content-type: text/event-stream`, `cache-control: no-cache`,
`connection: keep-alive`, `x-vercel-ai-ui-message-stream: v1`, `x-accel-buffering: no`.

Chunk sequence emitted by the happy path (each line = one SSE `data:` record, JSON
unwrapped here for readability):

1. `{"type":"data-status","data":{"phase":"thinking","requestId":"…","timestamp":"…"}}`
2. `data-status` × N `{"phase":"calling_tool","toolName":"…","stepIndex":N,"requestId":"…","timestamp":"…"}` (one per tool call)
3. `{"type":"data-status","data":{"phase":"composing","stepIndex":…,"requestId":"…","assistantMessageId":"<id>","timestamp":"…"}}`
4. `{"type":"start","messageId":"<assistantMessageId>"}`
5. `{"type":"text-start","id":"<textBlockId>"}`
6. `{"type":"text-delta","id":"<textBlockId>","delta":"<finalText>"}` (only if `finalText.length > 0`)
7. `{"type":"text-end","id":"<textBlockId>"}`
8. `{"type":"data-events","data":{"requestId":"…","assistantMessageId":"<id>","data":[ChatEventPayload…]}}` (only if events)
9. `{"type":"data-suggestions","data":{"requestId":"…","assistantMessageId":"<id>","data":[RefinementSuggestion…]}}` (only if suggestions)
10. `{"type":"data-directions","data":{"requestId":"…","assistantMessageId":"<id>","data":{"venueName","address","mapsUrl","eventName?"}}}` (only if directions)
11. `{"type":"data-execution-trace","data":{"requestId":"…","assistantMessageId":"<id>","data":[MessageExecutionStep…]}}`
12. `{"type":"data-status","data":{"phase":"done","stepIndex":…,"requestId":"…","assistantMessageId":"<id>","timestamp":"…"}}`
13. `{"type":"finish","finishReason":"stop"}`
14. `data: [DONE]`

The custom `data-*` parts all wrap their payload in `ChatStreamDataEnvelope<T>` =
`{ requestId: string, assistantMessageId?: string, data: T }` via the shared
`buildStreamEnvelope` helper (ported in card 05).

Error/refusal paths keep the legacy streaming contract (client expects a stream, never a
JSON body):

- Invalid request body / rate limited: `{"type":"error","errorText":"…"}` then
  `{"type":"finish","finishReason":"error"}`, then `data: [DONE]`.
- Mid-stream error after `start`: `data-status(phase:"error")` →
  `{"type":"error","errorText":"…"}` → `{"type":"finish","finishReason":"error"}`.

## Commands + outputs

### 1. `bunx tsc --noEmit`

```
(no output — zero errors)
```

### 2. `bunx vitest run src/features/chat/api/chat-contract.test.ts`

```
 RUN  v4.1.10 /Users/hanifcarroll/projects/ba-events-sveltekit

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  13:50:07
   Duration  863ms (transform 31ms, setup 0ms, import 747ms, tests 5ms, environment 0ms)
```

### 3. `grep -rn "@tanstack\|from 'react'" src/routes/api`

```
(no matches — empty, exit 1)
```

### 4. `bun run build`

```
✓ built in 2.50s   (ssr)
✓ built in 156ms   (client)
✔ done

server bundle contains (among others):
.svelte-kit/output/server/entries/endpoints/api/events/_server.ts.js    9.80 kB
.svelte-kit/output/server/entries/endpoints/api/chat/_server.ts.js     95.97 kB
```

Build completed with zero route errors (the only warnings are the existing
`adapter-netlify` deprecation / `NO_COLOR` env notices, unrelated to this card).

## Deviations

1. **`getClientIP` source order.** Legacy `getClientIP(request)` read only headers
   (`x-forwarded-for` → `x-real-ip` → `cf-connecting-ip` → `'unknown'` for chat,
   `'unknown-ip'` for events). Per card note 3, the port now calls
   `event.getClientAddress()` as the primary source and keeps the legacy header chain as
   the fallback in its original order. In dev this changes the rate-limit bucket key from
   `'unknown'`/`'unknown-ip'` to the socket address (`127.0.0.1`/`::1`); in production
   `getClientAddress()` honors trusted proxy headers. No other behavior change.
2. **`getUserToolContext` now takes `event`.** The legacy `createServerFn` version inferred
   the request from framework context; the ported feature module signature is
   `getUserToolContext(event: RequestEvent)`, so the route passes `event`. Pure mechanical
   adaptation of the contract's canonical signature, not a behavior change.
3. **`createEvent` (events POST).** `EventInsert` in this repo marks `description_display_*`
   / `description_summary_*` as optional, so the route omits them from `eventData` (they are
   supplied by `presentationFields` after `buildDescriptionPresentationFields`), exactly as
   legacy did. No semantic change.
4. **No `RequestHandler` type import.** Handlers are typed as
   `(event: RequestEvent): Promise<Response>` to avoid depending on the generated `$types`
   ambient route params for these param-less endpoints.

## Cross-import debts

None. All imported modules (`stream-helpers`, `tools-ai-sdk`, `user-tools.server`,
`prompts`, `suggestions`, `topic-guard`, `coverage-guard`, `providers`, `db/client.server`,
`analytics.server`, `formatting`, `api-response`, `embeddings`,
`description-presentation.server`, `rate-limit.server`, paraglide messages, `types`) already
exist and type-check.

## TODOs

None (`@migration TODO` search over `src/routes/api` returns empty).

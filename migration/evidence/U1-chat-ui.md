# U1 — chat-ui — evidence

## Scope done

All legacy chat UI sources ported React → Svelte 5 (runes), per `migration/CONTRACTS.md`.

### Remote wrappers (new)

- `src/features/chat/api/conversations.remote.ts` — `listConversations`, `searchConversations`, `getConversation` (queries) + `createConversation`, `updateConversation`, `deleteConversation` (commands), each delegating to the card-05 `.server.ts` fns via `getRequestEvent()`.
- `src/features/chat/api/messages.remote.ts` — `addMessage`, `updateMessageAttachedData` commands; exports the `AddMessageInput` type reused by the state class.
- `src/features/chat/api/generate-title.remote.ts` — `generateAndSaveTitle` command.

### State

- `src/features/chat/state/chat.svelte.ts` — `ChatState` class + `chatState` singleton. Ports `ChatProvider.tsx` (handoff `peek`/`take`, per-conversation scroll memory, `startNewChat` handler registration, reactive `activeConversationId`) and absorbs the `useConversations.ts` guest/authed branching (`listConversations`, `searchConversations`, `getConversation`, `getGuestConversation`, `createConversation`, `updateConversation`, `deleteConversation`, `addMessage`, `updateMessageAttachedData`, `generateTitle`). Adds `seedGuestConversation`/`invalidateGuestConversation` + `conversationsVersion` to replace the React Query cache-seed/invalidation that Svelte has no equivalent of.

### Components

- `src/features/chat/components/ChatContainer.svelte` — the streaming client + persistence orchestration (largest port; ~1000 lines incl. markup).
- `src/features/chat/components/ChatInput.svelte` — auto-growing textarea + Web Speech dictation wiring.
- `src/features/chat/components/ChatMessage.svelte` — markdown via `marked` + `dompurify` (client-side only).
- `src/features/chat/components/ChatPage.svelte` — reads `page.params`/`page.data`, drives URL on new-conversation.
- `src/features/chat/components/ConversationHistory.svelte` — signed-in sidebar list.
- `src/features/chat/components/DirectionsCard.svelte` — maps CTA.
- `src/features/chat/components/MessageList.svelte` — auto-scroll + completion top-alignment.
- `src/features/chat/components/RefinementSuggestions.svelte` — refinement chips.
- `src/features/chat/components/SuggestedPrompts.svelte` — home hero + surprise-me + `HomeTimeContext` (exported via `<script module>`).
- `src/features/chat/components/TrendingEvents.svelte` — "Happening soon" grid from prefetched route data.
- `src/features/chat/components/message-scroll.ts` — the pure scroll state machine extracted from `MessageList.tsx` so it is testable without a DOM (see deviations).

### Tests

- `src/features/chat/state/chat.test.ts` — logic-level port of `ChatProvider.test.tsx` + `ChatProvider.handoff.test.tsx` (peek non-destructive / take one-shot / later park overwrites / per-conversation scroll memory).
- `src/features/chat/components/message-scroll.test.ts` — logic-level port of `MessageList.scroll.test.tsx` (completion top-alignment state machine + scroll geometry math).

### Skipped barrels (contents noted per card)

- Legacy `src/features/chat/index.ts` re-exports: `generateSuggestions`, `SuggestionContext` (api/suggestions); `generateId`, `createUserMessage`, `createAssistantMessage`, `parseUserIntent`, `intentToFilters`, `generateResponse`, `formatPrice`, `formatEventTime` (lib/messages); `getSavedEvents`, `getSavedEventIds`, `saveEvent`, `unsaveEvent`, `isEventSaved` (lib/saved).
- Legacy `src/routes/-components/chat/index.ts` re-exports: `ChatContainer`, `ChatInput`, `ChatMessage`, `MessageList`, `SuggestedPrompts`.
- No `index.ts` barrels created in the new repo (per contract §1).

## Streaming-client decision: use `@ai-sdk/svelte` `Chat` (NOT hand-rolled)

The card allowed either the `Chat` class from `@ai-sdk/svelte` or a hand-rolled fetch
reader. I verified the `Chat` class consumes the legacy `/api/chat` envelopes natively, so
no hand-rolled reader is needed.

Proof (from `node_modules` + the A1 endpoint already in this repo):

1. `node_modules/@ai-sdk/svelte/dist/chat.svelte.js` — `export class Chat extends AbstractChat { constructor(init) { super({ ...init, state: new SvelteChatState(init.messages) }) } }`, where `SvelteChatState` holds `messages`/`status`/`error` as Svelte `$state` (so `chat.messages`, `chat.status` are reactive in runes components).
2. `AbstractChat` (same `ai` v7 package the legacy used) exposes the same callbacks the legacy React `useChat` relied on: `onData?: ChatOnDataCallback` (invoked per `data-*` chunk and the chunk is also appended to the assistant message `parts`), `onFinish?: ChatOnFinishCallback` (called with `{ message, messages, isAbort, isDisconnect, isError, finishReason }`), `onError?: (error: Error) => void`.
3. `DefaultChatTransport` (default transport) `sendMessages` merges the resolved `body` with `{ id, messages, trigger, messageId }` and POSTs to `/api/chat`; `processResponseStream` parses the AI SDK UI message stream (`parseJsonEventStream2` + `uiMessageChunkSchema`).
4. `src/routes/api/chat/+server.ts` (A1) writes exactly that protocol: `start`/`text-start`/`text-delta`/`text-end`/`finish`/`error` plus `data-status`, `data-events`, `data-suggestions`, `data-directions`, `data-execution-trace` (each `{ requestId, assistantMessageId?, data }`). My `onData` switch (`dataPart.type === 'data-status'` → cast to `ChatStreamStatusData`, etc.) is a line-for-line port of the legacy `onData` because the chunk shape is identical.

Therefore the wire format is unchanged; `ChatContainer.svelte` uses
`new Chat<ChatUIMessage>({ id, transport: new DefaultChatTransport({ api: '/api/chat', body: () => ({ locale, trendingEventId? }) }), onFinish, onError, onData })`.

## Commands + outputs

### `bunx tsc --noEmit` (acceptance #2)

Full-project non-build errors after `svelte-kit sync`: **0** (my files and all other
source files are clean).

```
$ bunx tsc --noEmit 2>&1 | grep -vE "build/_app" | grep -cE "error TS"
0
```

(The only remaining `tsc` diagnostics are 2945 lines in the gitignored `build/_app/**`
directory — a stale `vite build` artifact, present before this card and unrelated to it.
`tsconfig.json` has no `include`/`exclude` and `$app/tsconfig` sets `allowJs`/`checkJs`, so
tsc picks it up.)

### `bun run check` (svelte-check)

My `src/features/chat/**` files: **0 errors**.

```
$ bun run check 2>&1 | grep -cE "src/features/chat"
0
$ bun run check 2>&1 | tail -1
1786814384309 COMPLETED 5825 FILES 2945 ERRORS 0 WARNINGS 12 FILES_WITH_PROBLEMS
```

All 12 files-with-problems are `build/_app/immutable/**` (chunks/nodes/entry) — the stale
build artifact, not source.

### `bunx vitest run src/features/chat` (acceptance #3)

```
$ bunx vitest run src/features/chat 2>&1 | tail -4
 Test Files  14 passed (14)
      Tests  114 passed (114)
   Start at  14:20:03
   Duration  1.26s (transform 1.42s, setup 0ms, import 5.98s, tests 92ms, environment 4ms)
```

Includes the ported handoff + scroll tests:
```
$ bunx vitest run src/features/chat/state/chat.test.ts src/features/chat/components/message-scroll.test.ts 2>&1 | tail -4
 Test Files  2 passed (2)
      Tests  9 passed (9)
```

### `bunx @sveltejs/mcp svelte-autofixer` (acceptance #1)

All 11 `.svelte`/`.svelte.ts` files return `issues: []` (suggestions remain — see §9 note
below — none are severity-2):

```
OK chat.svelte.ts / DirectionsCard.svelte / RefinementSuggestions.svelte / TrendingEvents.svelte
OK SuggestedPrompts.svelte / ConversationHistory.svelte / ChatMessage.svelte / ChatInput.svelte
OK MessageList.svelte / ChatPage.svelte / ChatContainer.svelte
```

### Forbidden-string grep (acceptance #4)

```
$ grep -rnE "@tanstack|from 'react'|from \"react\"|import\.meta\.env|@ai-sdk/react" src/features/chat/state src/features/chat/components src/features/chat/api/*.remote.ts
(no output; exit 1 = clean)
```

## Deviations

1. **Test filename.** The card's table says `src/features/chat/state/chat.svelte.test.ts`,
   but `vite.config.ts`'s single vitest project (node env) has
   `exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']`, so a `.svelte.test.ts` file never
   runs. Named it `chat.test.ts` (still colocated) so the handoff tests actually execute
   under `bunx vitest run src/features/chat`.
2. **`MessageList.scroll.test.tsx` → extracted pure module.** The scroll state machine was
   extracted to `src/features/chat/components/message-scroll.ts` (co-located, not
   `chat/lib/**` which is out of scope per card boundaries) so the completion
   top-alignment logic is testable in the node project without DOM stubs.
3. **Authed conversation read now uses the route preload.** `ChatContainer.svelte` accepts a
   new `preloadedConversation` prop fed by `page.data.conversation` (U4's
   `chat/[conversationId]/+page.server.ts` already loads the signed-in conversation
   server-side). The legacy `useConversation` client fetch for authed is therefore dropped;
   guests still client-read IndexedDB. This avoids a duplicate server round-trip and matches
   the architecture U4 set up.
4. **Pull-to-refresh dropped.** `usePullToRefresh` + `PullToRefreshIndicator` are shared
   hooks/UI not present in the new repo and outside U1's scope. The scrollable container is
   kept (with `onscroll` scroll-memory), minus the mobile pull-to-refresh gesture.
5. **Guest conversation cache-seed.** React Query's `setQueryData(guestDetail(id))` seed has
   no Svelte equivalent, so `chatState.seedGuestConversation(id, …)` /
   `invalidateGuestConversation(id)` reproduce it (synchronous bootstrap on the handoff,
   IndexedDB read afterwards). No behavior change in the guest handoff.
6. **`{@html}` + eslint suppression.** Markdown rendering necessarily uses `{@html}` (after
   `DOMPurify.sanitize` of `marked` output). The autofixer's `svelte/no-at-html-tags` rule
   (severity 2) is suppressed with an inline
   `<!-- eslint-disable-next-line svelte/no-at-html-tags -->` comment that documents the
   sanitization. Legacy `react-markdown` escaped raw HTML; DOMPurify sanitizes it the same way.
7. **`autocorrect` attribute.** The non-standard (but mobile-meaningful) textarea
   `autocorrect` attribute is not in Svelte's HTML element types; passed via a spread of
   `Record<string, string>` so the attribute still reaches the DOM unchanged.
8. **lucide-svelte component type.** lucide-svelte v1 ships Svelte 4 class components, so the
   icon maps are typed `typeof SvelteComponentTyped<IconProps>` rather than Svelte 5's
   `Component<…>`.
9. **Autofixer `suggestions` remain (non-blocking, per §9).** The remaining diagnostics are
   severity-1 only: "use SvelteMap" for intentionally non-reactive maps, "`bind:this` →
   action/attachment", and "stateful variable assigned inside `$effect`" for the async
   guest-conversation load. These match the S2 evidence's established convention that
   suggestions are non-blocking; `issues` are all empty.
10. **`@tailwindcss/typography` not installed** (neither repo has it). The `prose prose-sm`
    utility classes are inert exactly as in the legacy; the `.prose-warm` custom vars the
    legacy relied on are present in `src/app.css`, so no styling regression vs legacy.
11. **Legacy `onFinish`-after-`onError` phase-reset quirk preserved.** `onFinish` runs in the
    `finally` of the request and calls `setRequestLifecyclePhase('persisting')` then, when the
    phase is no longer `'error'`, back to `'idle'` — so a stream error's `requestPhase` is
    reset by the subsequent `onFinish` while the `error` banner string stays. This is the
    legacy behavior; kept rather than "fixed" per contract §1.

## Cross-import debts

- `#features/events/components/EventList.svelte` (U2) — consumed by `ChatMessage.svelte`; present.
- `preloadedConversation`/`trending` rely on U4's `src/routes/+page.server.ts` and
  `src/routes/chat/[conversationId]/+page.server.ts` (`page.data`); present.
- `#features/chat/api/*.remote.ts` depend on card-05 `#features/chat/api/*.server.ts`; present.
- `#shared/ui/**` primitives (S2) and `#features/auth/hooks/auth-context.svelte.ts` (S1) used; present.

No missing modules.

## TODOs

None. `@migration TODO` list empty.

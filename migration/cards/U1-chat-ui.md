# Card U1 — chat-ui

## Objective

Port the entire chat frontend — streaming UI, conversation state, history — from React to
Svelte 5 (runes), per `migration/CONTRACTS.md`. This is the largest UI card; work
methodically, component by component.

## Scope (legacy base = /Users/hanifcarroll/projects/ba-events)

| Legacy | New |
|---|---|
| src/shared/providers/ChatProvider.tsx | src/features/chat/state/chat.svelte.ts |
| src/features/chat/hooks/useConversations.ts | absorbed into the state class + remote wrappers (no 1:1 file) |
| (new) | src/features/chat/api/conversations.remote.ts |
| (new) | src/features/chat/api/messages.remote.ts |
| (new) | src/features/chat/api/generate-title.remote.ts |
| src/routes/-components/chat/ChatContainer.tsx | src/features/chat/components/ChatContainer.svelte |
| ChatInput.tsx | ChatInput.svelte |
| ChatMessage.tsx | ChatMessage.svelte |
| ChatPage.tsx | ChatPage.svelte |
| ConversationHistory.tsx | ConversationHistory.svelte |
| DirectionsCard.tsx | DirectionsCard.svelte |
| MessageList.tsx | MessageList.svelte |
| RefinementSuggestions.tsx | RefinementSuggestions.svelte |
| SuggestedPrompts.tsx | SuggestedPrompts.svelte |
| TrendingEvents.tsx | TrendingEvents.svelte |
| ChatProvider.test.tsx, ChatProvider.handoff.test.tsx | src/features/chat/state/chat.svelte.test.ts (logic-level) |
| MessageList.scroll.test.tsx | logic-level test if extractable; else document drop |

Skip `chat/index.ts` and `-components/chat/index.ts` barrels (note contents).

## Key semantics to preserve (read the legacy files closely)

1. **PendingFirstMessage handoff** — home submits → navigate to /chat/[id] → remount;
   the parked message (with handoffId) is sent by the NEW instance. `peek` (idempotent)
   vs `take` (one-shot). The handoff tests encode this — port them first against
   `chat.svelte.ts` before building components.
2. **Guest vs authenticated persistence** — guests: Dexie (`#shared/lib/db/guest-conversations.ts`,
   `local-outbox.ts`, `#features/chat/lib/persistence-outbox.ts`); authed: remote wrappers
   over card-05 `.server.ts` fns. Legacy `useConversations` shows the exact branching.
3. **Streaming client** — legacy uses `useChat` from `@ai-sdk/react` with custom data
   envelopes (see `stream-helpers.ts` from card 05 and `#shared/lib/streaming-types.ts`).
   Port to the `Chat` class from `@ai-sdk/svelte`
   (`bunx @sveltejs/mcp get-documentation` does not cover it — read
   `node_modules/@ai-sdk/svelte/README.md` and its `dist/` types). The wire format is fixed
   by card A1 — if the svelte Chat class cannot consume the legacy envelopes, hand-roll a
   fetch reader that preserves the protocol exactly, and note it in evidence.
4. **Markdown** in ChatMessage: `react-markdown` → `marked` + `dompurify` (client-side only;
   legacy escaped raw HTML — sanitize accordingly).
5. Scroll-position memory per conversation; `startNewChat` handler registration;
   `speech-recognition.ts` (ported already) dictation wiring in ChatInput.
6. i18n via `#paraglide/messages.js`; analytics via `#shared/lib/analytics.ts` (`track`);
   toasts via `svelte-sonner`; icons `lucide-svelte`; primitives from `#shared/ui/*`
   (card S2's evidence lists their props).
7. Auth state via `useAuthContext()` from `#features/auth/hooks/auth-context.svelte.ts`
   (card S1).

## Acceptance

1. `bunx @sveltejs/mcp svelte-autofixer` clean on every file you wrote (re-run until clean).
2. `bunx tsc --noEmit` — zero errors in your files (in-flight missing-module errors
   tolerated per contract §10).
3. `bunx vitest run src/features/chat` — green, including the ported handoff tests.
4. No `@tanstack` / `react` / `import.meta.env` / `@ai-sdk/react` strings in your files.

## Boundaries

No deps (if `@ai-sdk/svelte` truly lacks a capability you need, document the workaround —
do not install anything). No git, no dev server. Do not touch routes (U4), endpoints (A1),
`chat/api/**` server modules (done — card 05), or `chat/lib/**` (done — card 06).

## Evidence

`migration/evidence/U1-chat-ui.md` per CONTRACTS.md §10. Must include the streaming-client
decision (Chat class vs hand-rolled) with proof the legacy envelope is consumed correctly.

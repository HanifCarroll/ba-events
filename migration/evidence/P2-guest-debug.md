# P2 — guest chat debug transcripts — Evidence

## Summary

Guest concierge chats are now mirrored server-side to a service-role-only
debug table so Hanif can look them up by conversation id. Guest UX is
unchanged (Dexie-only, no anon auth, no shareable links).

## Files changed

- `src/features/chat/components/ChatContainer.svelte` — transport `body` now
  sends `conversationId` (guests and authed users both send it; harmless for
  authed).
- `src/features/chat/api/guest-debug.server.ts` — new `upsertGuestChatDebug`
  helper (service-role upsert, swallows errors).
- `src/routes/api/chat/+server.ts` — parses `conversationId`; fire-and-forget
  debug write for guests at request start (incoming `uiMessages`) and again
  after the assembled reply (or error) exists.
- `src/features/chat/api/guest-debug.test.ts` — unit tests (mock the supabase
  client).
- `supabase/migrations/20260815161000_guest_chat_debug.sql` — table + RLS.
- `scripts/guest-chat-debug.ts` — read path for Hanif.

## Table

`public.guest_chat_debug`

- `conversation_id text PRIMARY KEY` — the client nanoid (NOT a UUID, no FK to
  `conversations`)
- `locale text`
- `ip text`
- `messages jsonb NOT NULL DEFAULT '[]'::jsonb` — full `uiMessages` array from
  the latest request
- `last_user_text text`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`

`ALTER TABLE guest_chat_debug ENABLE ROW LEVEL SECURITY;` with **no policies**
→ anon/authenticated roles cannot read or write. Only the service role (which
bypasses RLS) can touch it.

## Client change

`ChatContainer.svelte` `DefaultChatTransport.body`:

```svelte
body: () => {
    const trendingEventId = pendingTrendingEventIdRef
    pendingTrendingEventIdRef = null
    return {
        locale: getLocale() as 'en' | 'es',
        conversationId: conversationId ?? pendingConversationIdRef ?? null,
        ...(trendingEventId ? { trendingEventId } : {})
    }
}
```

## Server writes

Start of request (user turn only, so a crash still leaves the ask):

```ts
  if (!userContext.isAuthenticated) {
    persistGuestChatDebug({
      conversationId,
      locale,
      ip,
      messages: uiMessages,
      lastUserText: getLastUserQuery(uiMessages) || null,
    })
  }
```

After `finalText` is composed (and again on the stream `catch` with
`error`): `messages` is overwritten with
`buildGuestDebugTranscript(uiMessages, assistant)`, where the assistant
object is `{ id, role, parts: [{ type: 'text', text: finalText }],
executionTrace }` (plus `error` on failure).

`conversationId` is extracted in the body parse block:

```ts
    const body = (await request.json()) as {
      messages?: UIMessage[]
      locale?: 'en' | 'es'
      trendingEventId?: string
      conversationId?: string | null
    }
    ...
    conversationId = body.conversationId ?? null
```

The helper reuses the canonical service-role client
`getSupabaseServiceRoleClient` from `#shared/lib/db/service.server.ts` (the
same one auth/rate-limit uses) — no third client was introduced. Upsert is on
`conversation_id` (`onConflict: 'conversation_id'`), overwrites `messages` with
the latest `uiMessages`, and sets `updated_at`. Missing/empty `conversationId`
is a no-op. All errors are caught and logged with `logger.warn`.

## How to look up a chat

```bash
bun scripts/guest-chat-debug.ts <conversationId>
```

Prints `updated_at`, `locale`, `last_user_text`, each message `role` +
`text`, and any assistant `executionTrace` steps (tool name + input, plus
step text when present). Uses the service role from `.env`. Exits 1 when
the record is missing or the query fails. No admin UI.

## Acceptance checks (actually run)

### 1. Autofixer clean on `ChatContainer.svelte`

```
bunx @sveltejs/mcp svelte-autofixer src/features/chat/components/ChatContainer.svelte
```

Result: `issues: []` (suggestions only, no issues).

### 2. Unit test (`guest-debug.server.ts` via `guest-debug.test.ts`)

Covers: upsert is called with the conversation id (+ full payload and
`onConflict`); empty id is a no-op (client never called); client throw is
swallowed.

### 3. Vitest

```
bunx vitest run src/features/chat/api/guest-debug.test.ts
```

Result: `Test Files 1 passed (1)` / `Tests 3 passed (3)`.

### 4. TypeScript

```
bunx tsc --noEmit
```

Result: no output — zero errors.

### 5. Script read path

- `bun scripts/guest-chat-debug.ts` (no args) → prints usage, exit 1.
- `bun scripts/guest-chat-debug.ts guest-nonexistent-nanoid-000` → exit 1
  (`Could not find the table 'public.guest_chat_debug' in the schema cache` —
  expected: the migration file has not been applied to the live DB from this
  environment; the script correctly exits non-zero on any lookup failure).

## Notes

- `bunx vitest run src/features/chat/api/` still reports one pre-existing
  failure in `src/features/chat/api/tools/search-events.test.ts` (oxc parse
  error at line 377). That file was **not** touched by this card and is outside
  its boundaries (search ranking / enrichment). My test file passes in the same
  run (6 passed test files, 76 tests).

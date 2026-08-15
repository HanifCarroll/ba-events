# Card P2 — guest chat debug transcripts

## Objective

When a guest (not signed in) talks to the concierge, save a server-side copy
of that chat so Hanif can look it up by conversation id when something breaks.

Guest UX stays the same: Dexie on their browser, URL still only works there.
No anonymous auth. No shareable guest links.

## Root cause (verified)

`/api/chat` is stateless. Guests persist only in
`src/shared/lib/db/guest-conversations.ts` (Dexie). The chat transport
(`ChatContainer.svelte` `DefaultChatTransport.body`) sends `locale` and
optional `trendingEventId` — **not** `conversationId`.

## Required changes

### 1. Send `conversationId` from the client

In `src/features/chat/components/ChatContainer.svelte`, add
`conversationId: conversationId ?? pendingConversationIdRef ?? null` to the
transport `body` (same place as `locale`). Guests and authed users both send
it. Harmless for authed (we ignore it server-side for this feature).

### 2. Table (service-role only)

Migration: `supabase/migrations/20260815161000_guest_chat_debug.sql`

```sql
CREATE TABLE guest_chat_debug (
  conversation_id text PRIMARY KEY,
  locale text,
  ip text,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_user_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE guest_chat_debug ENABLE ROW LEVEL SECURITY;
-- no policies → anon/authenticated cannot read or write
```

`conversation_id` is the client nanoid (not a UUID). Do not FK to
`conversations`.

### 3. Server write

New module `src/features/chat/api/guest-debug.server.ts`:

```ts
export async function upsertGuestChatDebug(input: {
  conversationId: string
  locale: 'en' | 'es'
  ip: string
  messages: unknown
  lastUserText: string | null
}): Promise<void>
```

- Use the existing service-role client pattern
  (`createServiceRoleClient` from `#trigger/utils/db-client.ts` **or** the
  canonical helper already used by auth/rate-limit — reuse, do not invent a
  third client).
- Upsert on `conversation_id`. Overwrite `messages` with the latest request
  payload (full `uiMessages` array). Update `updated_at`.
- Swallow errors (log with `logger.warn`). Debug persist must never fail the
  chat response.
- No-op when `conversationId` is missing/empty.

Call it from `src/routes/api/chat/+server.ts` **only when
`!userContext.isAuthenticated`**, after the body is parsed and rate-limit
passes. Fire-and-forget (`void upsert...().catch(...)`) so it does not delay
the stream.

Do **not** persist authenticated chats here.

### 4. Read path for Hanif

A tiny script `scripts/guest-chat-debug.ts`:

```
bun scripts/guest-chat-debug.ts <conversationId>
```

Prints `updated_at`, locale, last_user_text, and each message role + text.
Uses service role from `.env`. Exit 1 if not found.

No admin UI.

## Do not

- Call `signInAnonymously`.
- Relax RLS on `conversations` / `messages`.
- Dual-write guests into `conversations`.
- Add deps.
- Run `git` or `vite dev`.
- Touch enrichment or search ranking.

## Acceptance

1. Autofixer clean on `ChatContainer.svelte` if you edited it.
2. Unit test `guest-debug.server.ts` (mock the supabase client): upsert is
   called with the conversation id; empty id is a no-op; client throw is
   swallowed.
3. `bunx vitest run src/features/chat/api/guest-debug.server.ts` (or wherever
   you put the test) passes.
4. `bunx tsc --noEmit` — zero errors in files you touched.
5. Evidence: `migration/evidence/P2-guest-debug.md` with the table name, the
   exact call site in `+server.ts`, and how to look up a chat.

## Boundaries

`src/features/chat/api/guest-debug.server.ts` (+ test),
`src/routes/api/chat/+server.ts`,
`src/features/chat/components/ChatContainer.svelte` (transport body only),
`supabase/migrations/20260815161000_guest_chat_debug.sql`,
`scripts/guest-chat-debug.ts`,
evidence file.

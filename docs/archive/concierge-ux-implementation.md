# Concierge UX Implementation

**Date:** 2026-03-10
**Status:** Current

This document reflects the shipped concierge architecture after the plan-first simplification.

## Current Experience

- Chat recommends events through `/api/chat`.
- Single strong recommendations render as a hero recommendation card.
- Users can explicitly confirm a choice with `Make this my plan`.
- Confirmed plans render as `YourPlanCard` in chat and persist to `saved_events.planned_at` for signed-in users.
- The Saved page is the durable revisit surface for plans.
- Generic chat-history browsing is no longer part of the product surface.

## Current Architecture

- **Streaming chat endpoint:** `src/routes/api/chat.ts`
- **Chat container and persistence:** `src/routes/-components/chat/ChatContainer.tsx`
- **Recommendation cards:** `src/routes/-components/events/EventCard.tsx`
- **Confirmed plan card:** `src/routes/-components/chat/YourPlanCard.tsx`
- **Saved-plan persistence:** `src/features/chat/lib/saved.ts`
- **Authenticated conversation storage:** `conversations` and `messages` tables in Supabase
- **Retry-only local persistence:** `src/shared/lib/db/local-outbox.ts`

## Key Product Rules

- Auth is magic-link only.
- Anonymous chat is available but ephemeral for the current session.
- Only authenticated users get durable conversation/message persistence.
- Plans are explicit user actions, not automatic intent inference.
- `saved_events` is the single source of truth for saves and plans.

## Removed Flows

- Password login/signup UI
- Automatic personalization modal after login
- `/chats` archive browsing, rename, delete, and search
- Anonymous conversation archive and migration
- Legacy `src/features/chat/api/agent.ts` implementation

## Data Model Notes

- `saved_events.planned_at` is `null` for ordinary saves.
- `saved_events.planned_at` is populated when a user confirms a plan.
- Assistant messages can persist a `plan` payload in `attached_data` so confirmed plan cards reload with conversation history.

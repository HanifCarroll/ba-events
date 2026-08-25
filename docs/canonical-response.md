# Canonical response

The v5 response contract remains the UI boundary. The ToolLoopAgent writes the
final visible `text`, but structured cards, directions, venue data, links, and
provenance are derived only from successful executed tool results. Model prose
cannot create or modify canonical artifacts.

`src/shared/lib/types.ts` remains the source of truth. The production path is
`src/features/chat/api/agent/orchestrate.ts`; it wraps the existing search,
details, directions, venue, and saved-list implementations with AI SDK
`tool()`. The loop is bounded to five steps and has a timeout and retry.

Prior references use server-owned `requestId:event_N` handles. Same-turn
results expose opaque refs for later tool calls while raw IDs stay in the server
artifact ledger; unknown refs fail closed. `operations` remains empty: chat
never saves or unsaves. The card heart
is still the only mutation surface.

# Concierge architecture

BA Events uses one bounded Vercel AI SDK 7 `ToolLoopAgent` in `src/features/chat/api/agent/orchestrate.ts`.

```text
recent visible DATA + server-rehydrated event facts
        -> ToolLoopAgent (DeepSeek, max 5 steps)
        -> existing read tools and their results
        -> model final prose + server-built canonical cards
```

The agent may chain search, details, venue, directions, and saved-list reads.
After a non-empty search, `prepareStep` removes search from the active tool set
so the agent must use returned refs rather than repeat discovery. It never
receives chat mutation tools. Save/unsave intent is carried as a validated
details-read purpose so web can show the heart control and Telegram can replace
that web-only guidance. Both channels call `runSharedChatTurn`; only rendering
differs.

Prior event references are stable server handles (`requestId:event_N`). Each
same-turn result receives an opaque `eventRef`/`venueRef` for later calls; raw
IDs remain in the server artifact ledger. Unknown refs fail closed. Prior IDs
and names are rehydrated from the database. Recent user and assistant text is
bounded and labelled untrusted DATA.

Canonical cards, directions, venue data, provenance, clarification questions,
and links come only from ordered successful tool results. The model supplies
final prose and is explicitly instructed to ground it in current results or
active server facts. If a final model step times out after successful reads,
those canonical artifacts survive with deterministic error text. Failures
without a successful read return the deterministic error response. Saves
remain the card-heart mutation surface.

# Chat Streaming and Response Contract

The chat API uses response contract **v5** — the closed canonical response. A
turn is two deterministic server phases with exactly ONE model call in between:

1. **Planner** — one `generateText` call with `Output.object` against a closed
   Zod `TurnPlan` schema (`src/features/chat/api/agent/planner.ts`). NO tools,
   no work loop, no free text. The model selects one finite plan (search /
   prior_event_action / pinned_event_action / list_saved / clarification /
   out_of_scope).
2. **Executor** — `runExecutor`
   (`src/features/chat/api/agent/executor.ts`) runs the plan deterministically
   against the existing tool implementations (search / details / directions /
   venue / list-saved) and builds the `CanonicalChatResponse` server-side. Text
   is materialized from a closed `messageKey` (`materialize.ts`); the model
   never writes visible prose.

The planner is the only model call. There is no work loop, no finalizer, no
second generation, no ledger, and no repair model call on failure.

## Server phases

1. **Rehydrate** — the route parses prior event ids from untrusted/persisted
   canonicals (bounded Zod), re-fetches facts from the DB, and reduces them to
   server-owned handles + response/display order + facts + saved membership.
2. **Plan** — `runPlanner` returns a `TurnPlan` (or a typed failure:
   `invalid_schema` / `planner_error`).
3. **Execute** — `runExecutor` performs at most one search + one follow-up read
   (or one saved-events / prior / pinned read), validates handles and
   `resultIndex` exactly, and constructs the canonical.
4. **Stream** — the route writes one text block, one `data-response`, and a
   sanitized `data-execution-trace` (reads only).

## Fail-closed

- Planner provider/schema failure → deterministic `error` canonical
  (`fallbackUsed: true`, typed `fallbackReason`), never a repair call.
- Invalid handle / out-of-range `resultIndex` → deterministic clarification.
- A requested-but-unresolved pinned event → typed `pinned_event_unavailable`.

## Save / unsave

The chat never mutates. Save/unsave requests are planned as
`show_for_save` / `show_for_unsave`, which return the exact event card plus a
deterministic message pointing at the card's own Save/Unsave control.

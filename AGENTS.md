# BA Events — SvelteKit 3

SvelteKit 3 RC + Svelte 5 (runes) + Vite 8 + TypeScript 6. **Bun only.**

## Commands

```bash
bun run check
bun run test
bunx vitest run <path>
bunx tsc --noEmit
```

Never start the dev server.

## Chat Analysis

When asked to analyze a chat URL, extract its `/chat/<conversationId>` value and inspect the stored transcript and execution trace with:

```bash
bun scripts/guest-chat-debug.ts <conversationId>
```

Use this service-role database read as the primary evidence; do not rely on `fetch_content`, the rendered page, or screenshots alone. If no guest record exists, query the authenticated `conversations` record with the existing Supabase service-role client. Keep all database access read-only and never print credentials.

## Environment Variables

### AI APIs

- `VOYAGE_API_KEY` — Voyage AI hosted reranker key for `search_events` stage-2 (optional; search falls back to retrieval order without it).

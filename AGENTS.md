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

## Environment Variables

### AI APIs

- `VOYAGE_API_KEY` — Voyage AI hosted reranker key for `search_events` stage-2 (optional; search falls back to retrieval order without it).

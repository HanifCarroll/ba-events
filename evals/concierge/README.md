# Concierge eval

Two layers verify the ToolLoopAgent concierge:

1. **Deterministic** — `deterministic.test.ts`, no model/database, discovered by
   `bun test`. It uses the injected agent runner and covers follow-ups,
   ambiguity, tool chaining, refs, grounding, pins, empty results, and shared
   web/Telegram history.
2. **Live** — `run.ts`, explicitly invoked against DeepSeek and the dev database.

```bash
bun test evals/concierge/deterministic.test.ts
bun run eval:concierge       # requires live credentials
```

The live runner calls `orchestrate` with the installed DeepSeek model and
scores tool reads, limits, locale, zero chat mutations, and canonical card
provenance. It must not be run accidentally.

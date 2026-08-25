# Concierge eval coverage

The deterministic suite runs without a model or database; the live suite runs
against the real ToolLoopAgent only when explicitly invoked.

`evals/concierge/deterministic.test.ts` covers CHEBA description continuity,
pronouns and ordinals, genuine ambiguity, multi-step search plus details or
directions, exact ref-to-ID validation, prose/card grounding, pin behavior,
and shared web/Telegram history. `agent/history.test.ts` covers history bounds
and current-turn de-duplication. Follow-up tests retain adversarial rehydration
and authoritative saved-membership coverage.

The live cases in `evals/concierge/cases.ts` exercise search-field selection,
limits, scope refusals, locale, grounding, compound tool calls, and zero chat
mutations. Web and Telegram both use `runSharedChatTurn`; channel rendering is
outside the agent.

```bash
bun test evals/concierge/deterministic.test.ts
bun run eval:concierge       # requires explicit live credentials
```

Live evaluation needs the existing DeepSeek, Supabase, embedding, and optional
Voyage environment variables. Never run it accidentally or commit secrets.

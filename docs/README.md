# Docs

**Source of truth:** [`decisions.md`](./decisions.md) — a newest-first log of architectural decisions. Start there.

## Current

Canonical chat contract and trust model:

- [`canonical-response.md`](./canonical-response.md) — the field-by-field v4 chat response schema
- [`chat-trust-boundary.md`](./chat-trust-boundary.md) — what the server validates vs. trusts
- [`chat-streaming.md`](./chat-streaming.md) — streaming/token lifecycle
- [`chat-persistence-migration.md`](./chat-persistence-migration.md) — guest reply + reasoning persistence
- [`search-stage-lifecycle.md`](./search-stage-lifecycle.md) — ordered search stage eligibility/outcomes
- [`fallback-rules.md`](./fallback-rules.md) — deterministic fallback rules
- [`follow-up-display-groups.md`](./follow-up-display-groups.md) — follow-up reference rendering

Broader architecture and planning:

- [`agent-native-architecture.md`](./agent-native-architecture.md)
- [`constrained-semantic-retrieval-plan.md`](./constrained-semantic-retrieval-plan.md)
- [`simplification-plan.md`](./simplification-plan.md)
- [`analytics.md`](./analytics.md)
- [`concierge-evals.md`](./concierge-evals.md)
- [`event-import-enrichment.md`](./event-import-enrichment.md)
- [`seo.md`](./seo.md)

## Archived

Pre-SvelteKit planning docs from the React (TanStack Start) era live in [`archive/`](./archive/). They are kept for history only — do not treat them as current spec.

# Docs

Start with [getting started](getting-started.md), [architecture](architecture.md), and [contributing](../CONTRIBUTING.md).

**Decision history:** [`decisions.md`](./decisions.md) — a newest-first log of architectural decisions; older entries describe historical implementations.

## Current

- [`development.md`](./development.md) — stack, checks, chat diagnosis, search configuration, and canonical contracts
- [`effect-4.md`](./effect-4.md) — version-matched Effect boundaries and deliberate exceptions
- [`applied-ai-engineering-work.md`](./applied-ai-engineering-work.md) — remaining work and verification receipts

Canonical chat contract and trust model:

- [`canonical-response.md`](./canonical-response.md) — the field-by-field v4 chat response schema
- [`chat-trust-boundary.md`](./chat-trust-boundary.md) — what the server validates vs. trusts
- [`chat-streaming.md`](./chat-streaming.md) — streaming/token lifecycle
- [`chat-persistence-migration.md`](./chat-persistence-migration.md) — guest reply + reasoning persistence
- [`follow-up-display-groups.md`](./follow-up-display-groups.md) — follow-up reference rendering

Broader architecture and planning:

- [`agent-native-architecture.md`](./agent-native-architecture.md)
- [`constrained-semantic-retrieval-plan.md`](./constrained-semantic-retrieval-plan.md)
- [`simplification-plan.md`](./simplification-plan.md)
- [`analytics.md`](./analytics.md)
- [`concierge-evals.md`](./concierge-evals.md)
- [`event-import-enrichment.md`](./event-import-enrichment.md)
- [`cloudflare-workers-builds.md`](./cloudflare-workers-builds.md)
- [`seo.md`](./seo.md)

## Archived

Pre-SvelteKit planning docs from the React (TanStack Start) era live in [`archive/`](./archive/). They are kept for history only — do not treat them as current spec.

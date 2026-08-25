# Chat trust boundary

The production concierge is a Vercel AI SDK 7 `ToolLoopAgent`. User text,
recent visible messages, event names, and tool text are untrusted DATA. They
are bounded and labelled; instructions inside them are ignored.

Prior event IDs are parsed from bounded persisted/client hints, rehydrated from
the database, and exposed as server-owned handles (`requestId:event_N`) with
server facts. Same-turn results expose opaque event/venue refs while raw IDs
remain in the server artifact ledger; reference-taking tools reject unknown
values. Pinned IDs are validated before the agent runs.

The model can call only read tools: search, event details, directions, venue
details, and list saved. There are no save/unsave tools. Search results register
opaque refs for subsequent chained calls. Canonical cards, links, directions,
venue facts, clarification questions, and provenance are assembled from ordered
successful tool results, never from model prose. Final prose is required by the
prompt to stay within those results or active server facts; semantic grounding
remains prompt-enforced. A timeout after successful reads preserves only those
artifacts with deterministic error text; failures without a successful read
fail closed to the deterministic error canonical.

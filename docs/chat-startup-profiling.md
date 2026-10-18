# Chat startup profiling

Release decision: `no_ai_behavior_change`. This release adds server-only
`chat-timing-v1` records for request/session loading, durable admission,
Workflow dispatch, execution/rate/history/context/provider preparation, bounded
trace export, checkpoint/commit and final publication. Model requests, prompts,
thinking, retrieval, card output and producer scheduling remain unchanged.

Records correlate a validated attempt UUID across services and contain only
allowlisted stage/phase/scope/version and numeric durations. They omit chat
content, headers, credentials, URLs and account identifiers. Sink failure is
isolated from execution. Local monotonic durations must not be added across
overlapping scopes. `sinceAdmissionMs` uses persisted admission wall time;
negative/skewed gaps remain unknown. Module evaluation precedes the earliest
application marker, so platform invocation data is still needed for that gap.

The production experiment will measure separate sequential three-turn guest
conversations (discovery, assessment and directions), retaining failures and
correlating client SSE milestones with service logs and model/tool spans.
First message of a new conversation is distinct from a cold Worker start.
Semantic-search and browser observations will be identified separately.
The cohort is diagnostic, not a load test or a service-level p95 estimate.

Independent model-quality calibration remains unknown. This instrumentation
does not promote the separately evaluated thinking-disabled setting or release
the local repeated-card fix. Rollback restores the recorded prior Worker
versions without data/schema changes. Release gates and production attribution
will be recorded in the private receipt and shared engineering worklist.

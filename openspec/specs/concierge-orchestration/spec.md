# Concierge Orchestration Specification

## Purpose
Define the bounded, read-only concierge turn that produces prose and server-owned canonical artifacts for web and Telegram.

## Requirements

### Requirement: Concierge execution is bounded and read-only
The concierge MUST use a bounded ToolLoopAgent with only search, event detail, venue detail, directions, saved-list, clarification, and recommendation-mismatch reads. It MUST NOT expose save or unsave mutations.

#### Scenario: Agent completes a normal turn
- **WHEN** the model handles a request
- **THEN** execution stops within the configured step, tool-call, per-tool, per-step, and total-time limits

#### Scenario: A read reaches its deadline
- **WHEN** an in-flight tool read reaches the per-tool deadline
- **THEN** its underlying database, embedding and reranking requests receive cancellation
- **AND** its late result cannot add artifacts, references or successful-search state
- **AND** successful earlier reads remain available under the existing fallback rules

#### Scenario: The producer or model step is interrupted
- **WHEN** producer cancellation, Effect interruption or an SDK step/total deadline stops execution
- **THEN** active model and tool requests receive that cancellation
- **AND** cancelled context preparation cannot start a model request afterward
- **AND** caller cancellation is not treated as a reranking outage that starts fallback work
- **AND** ordinary subscriber disconnects retain the independent producer and replay contract

#### Scenario: Parallel retrieval fails before all branches finish
- **WHEN** a tool read settles while one of its owned requests remains pending
- **THEN** the read scope cancels the remaining request without cancelling the whole turn
- **AND** a failed branch cannot leave paid or database work running after its read is over

#### Scenario: User asks to save an event
- **WHEN** save or unsave intent is detected
- **THEN** the agent may retrieve the event for display but provides no mutation tool

#### Scenario: Long prior dialogue reaches the context budget
- **WHEN** prior dialogue exceeds twelve messages, two thousand characters per message or six thousand characters overall
- **THEN** the model receives a contiguous suffix of recent bounded messages
- **AND** the current user request, server-rehydrated references and previous search constraints remain separate from dialogue truncation

#### Scenario: A completed model request exceeds the observed input-token budget
- **WHEN** the provider reports more than sixteen thousand input tokens including instructions, schemas and accumulated model context
- **THEN** the next model step is prevented and usage telemetry identifies the budget excess
- **AND** successful reads retain canonical artifacts under the existing final-generation failure rules
- **AND** this observed-usage guard does not claim to prevent the completed request's initial overshoot

### Requirement: Canonical artifacts come from successful reads
Cards, links, directions, venue facts, provenance, and clarification data MUST be assembled from validated successful tool results. Model prose MUST NOT create or alter canonical artifacts.

#### Scenario: Model names unsupported facts
- **WHEN** final prose contains a fact absent from successful reads or active server facts
- **THEN** that prose does not add the fact to canonical structured output

#### Scenario: Event reads contain multiple description representations
- **WHEN** a search, details or saved-list read supplies original description text alongside rendered copies and summaries
- **THEN** model-facing facts retain complete original descriptions without redundant rendered/summary copies
- **AND** records without originals retain rendered descriptions, or summaries when rendered descriptions are also absent
- **AND** the source fields and missing-description flags remain unchanged
- **AND** canonical cards retain all stored presentation fields independently of the model projection

### Requirement: Progressive web previews preserve the canonical trust boundary
The web channel SHALL publish transient previews using the final response's server assembler after successful reads and during model prose generation. Previews SHALL retain existing artifact, framing and reason validation and SHALL NOT be stored as completed responses. Exactly one final canonical response SHALL be published after the persistence gate and any required authoritative commit.

#### Scenario: Search completes while final generation is still running
- **WHEN** a successful read produces event cards before the final model step completes
- **THEN** the browser can render those server-derived cards progressively
- **AND** later prose cannot add, reorder, or replace their structured facts
- **AND** model reasoning, raw tool payloads, reference bookkeeping and incomplete framing markers are not exposed

#### Scenario: Model generation continues after a browser Stop
- **WHEN** the running attempt has been cancelled before the persistence gate
- **THEN** late reads and text cannot publish a final canonical response

### Requirement: References are server-owned and fail closed
Prior results MUST be rehydrated into bounded server-owned handles, same-turn reads MUST use opaque references, and unknown references MUST NOT resolve to raw event or venue identifiers.

#### Scenario: Unknown event reference is submitted
- **WHEN** a tool receives an event reference outside the server ledger
- **THEN** the read fails without disclosing or guessing an event

### Requirement: Read success survives final-generation failure
If final generation fails after successful reads, the response SHALL retain validated canonical artifacts with deterministic failure text. A turn with no successful read SHALL fail closed.

#### Scenario: Final model step times out
- **WHEN** at least one read completed successfully before timeout
- **THEN** its validated artifacts remain in the canonical response

### Requirement: Optional observability preserves turn behavior
The concierge MAY export model and tool tracing to its dedicated Langfuse project
when server credentials are configured. Trace context SHALL contain request and
conversation identifiers without authentication credentials, delivery capabilities,
or raw user-tool context. Missing credentials and export failures MUST NOT retry
model execution or change the turn result. Export waiting SHALL be bounded.

#### Scenario: A configured turn identifies its prompt and model configuration
- **WHEN** the production model runner exports a configured turn
- **THEN** trace metadata includes an explicit instruction-template revision
- **AND** a configuration fingerprint identifies the selected model/provider, canonical contract, supplied tool names, execution/context limits, retries and thinking settings
- **AND** the fingerprint excludes messages, credentials and per-user context
- **AND** the prompt revision and application release distinguish template/code changes without changing model execution

#### Scenario: Langfuse is unavailable
- **WHEN** tracing is unconfigured or its exporter fails
- **THEN** the concierge retains the same execution, fallback and canonical-artifact rules
- **AND** no additional model attempt is made to recover tracing

### Requirement: Conversation evaluations retain actual context and fixed data
Concierge regression evaluations SHALL execute sequential turns through shared
production preparation and orchestration with controlled read data and a fixed
Buenos Aires date. Independent trials SHALL start with empty conversation state
and record corpus identity. Missing or failed turns or trials MUST fail the
evaluation gate; model variability SHALL remain visible in per-trial results.

#### Scenario: A follow-up names the second option
- **WHEN** a model evaluation continues after a result-bearing response
- **THEN** prior references and search context come from that actual response
- **AND** the expected target is the second event in the actual newest displayed list
- **AND** fixture reads and prior-event rehydration use the same frozen corpus

#### Scenario: One repeated trial fails
- **WHEN** a conversation has a mixture of passing and failing independent trials
- **THEN** its report retains the per-trial failures and aggregate pass rate
- **AND** the suite fails instead of reporting only the best trial

#### Scenario: Prose quality is evaluated separately from card provenance
- **WHEN** a model evaluation grades factuality, suitability, explanation accuracy or usefulness
- **THEN** the grade uses the actual model-visible read evidence and active state from that run
- **AND** supported prose claims require citations to available authoritative evidence
- **AND** missing evidence or invalid grades are errors, not passing scores
- **AND** non-applicable dimensions retain explicit coverage rather than a fabricated pass

#### Scenario: A judge has not been compared against human labels
- **WHEN** an automatic quality score has no completed independent human calibration
- **THEN** it remains labeled uncalibrated
- **AND** diagnostic model or developer expectations cannot be reported as human agreement

#### Scenario: An adversarial conversation supplies source instructions
- **WHEN** a real-model evaluation injects malicious event data or earlier conversation text
- **THEN** its receipt proves that the payload reached the captured model input
- **AND** source instructions cannot silently change expected filters, ordinal targets or canonical directions
- **AND** attacker strings and credential-collection prompts in visible prose fail the evaluation
- **AND** malicious fixtures retain their own fingerprints without changing the ordinary frozen corpus

## Verification

### Implementation anchors
- `src/features/chat/api/agent/orchestrate.ts`
- `src/features/chat/api/agent/shared-turn.server.ts`
- `src/features/chat/api/agent/follow-up.ts`
- `src/features/chat/api/agent/trace.ts`
- `src/features/chat/api/execute.server.ts`
- `src/features/chat/lib/progress.ts`
- `src/shared/lib/types.ts`

### Deterministic tests
- `src/features/chat/api/agent/orchestrate.test.ts`
- `src/features/chat/api/agent/shared-turn.server.test.ts`
- `src/features/chat/api/agent/follow-up.test.ts`
- `src/features/chat/api/agent/trace.test.ts`
- `src/features/chat/api/agent/concierge-multi-turn.test.ts`
- `src/features/chat/api/agent/bounded-read.test.ts`
- `src/features/chat/api/agent/model-cancellation.test.ts`
- `src/shared/lib/db/read-signal.test.ts`
- `src/shared/lib/ai/embeddings.test.ts`
- `src/shared/lib/search/rerank.test.ts`

### Verification command
```sh
bunx vitest run src/features/chat/api/agent/orchestrate.test.ts src/features/chat/api/agent/shared-turn.server.test.ts src/features/chat/api/agent/follow-up.test.ts src/features/chat/api/agent/trace.test.ts
```

### Advisory conformance review
`$openspec-review-conformance concierge-orchestration` is advisory rather than proof.

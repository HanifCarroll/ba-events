# Concierge Orchestration Specification

## Purpose
Define the bounded, read-only concierge turn that produces prose and server-owned canonical artifacts for web and Telegram.

## Requirements

### Requirement: Concierge execution is bounded and read-only
The concierge MUST use a bounded ToolLoopAgent with only search, event detail, venue detail, directions, saved-list, clarification, and recommendation-mismatch reads. It MUST NOT expose save or unsave mutations.

#### Scenario: Agent completes a normal turn
- **WHEN** the model handles a request
- **THEN** execution stops within the configured step, tool-call, per-tool, per-step, and total-time limits

#### Scenario: User asks to save an event
- **WHEN** save or unsave intent is detected
- **THEN** the agent may retrieve the event for display but provides no mutation tool

### Requirement: Canonical artifacts come from successful reads
Cards, links, directions, venue facts, provenance, and clarification data MUST be assembled from validated successful tool results. Model prose MUST NOT create or alter canonical artifacts.

#### Scenario: Model names unsupported facts
- **WHEN** final prose contains a fact absent from successful reads or active server facts
- **THEN** that prose does not add the fact to canonical structured output

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

### Verification command
```sh
bunx vitest run src/features/chat/api/agent/orchestrate.test.ts src/features/chat/api/agent/shared-turn.server.test.ts src/features/chat/api/agent/follow-up.test.ts src/features/chat/api/agent/trace.test.ts
```

### Advisory conformance review
`$openspec-review-conformance concierge-orchestration` is advisory rather than proof.

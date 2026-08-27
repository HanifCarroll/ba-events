# Chat Turn Persistence Specification

## Purpose
Define durable, idempotent chat turns and one canonical stored assistant response across authenticated and guest conversations.

## Requirements

### Requirement: One logical submission has one durable turn
A submitted message MUST use stable user and assistant client identifiers. Repeated bootstrap or completion for the same logical turn MUST reuse the stored turn or assistant message rather than create a duplicate.

#### Scenario: Client retries the same submission
- **WHEN** the same client identifiers are submitted again
- **THEN** the existing durable turn and completed assistant response are returned

### Requirement: Turn execution uses bounded claims
Only a valid active claim SHALL complete or fail a running turn. Expired running claims SHALL be exposed as interrupted and MAY be reclaimed through the explicit retry path.

#### Scenario: Stale worker completes a reclaimed turn
- **WHEN** its claim no longer owns the turn
- **THEN** completion is rejected and the current turn state is preserved

### Requirement: Canonical responses are stored without reconstruction
New assistant messages MUST persist the server-produced canonical response, visible text, contract version, and sanitized execution trace. Guest and authenticated storage MUST NOT reconstruct canonical artifacts from client callbacks.

#### Scenario: A completed turn is reloaded
- **WHEN** history is read later
- **THEN** the stored canonical response remains the rendering authority

### Requirement: Historical contracts adapt without rewriting rows
Supported historical message contracts SHALL be adapted at read time to the current render shape. Unknown or malformed canonical data MUST NOT be cast as current.

#### Scenario: Legacy message is loaded
- **WHEN** a v2 or v3 row is read
- **THEN** it is adapted with legacy provenance while the stored row remains unchanged

## Verification

### Implementation anchors
- `src/features/chat/api/turns.server.ts`
- `src/features/chat/api/messages.server.ts`
- `src/features/chat/api/agent/persist.ts`
- `src/features/chat/lib/canonical.ts`
- `src/shared/lib/db/guest-conversations.ts`

### Deterministic tests
- `src/features/chat/api/turns.server.test.ts`
- `src/features/chat/api/turn-authority.test.ts`
- `src/features/chat/api/chat-durability.test.ts`
- `src/features/chat/lib/canonical.test.ts`
- `src/shared/lib/db/guest-conversations.test.ts`

### Verification command
```sh
bunx vitest run src/features/chat/api/turns.server.test.ts src/features/chat/api/turn-authority.test.ts src/features/chat/api/chat-durability.test.ts src/features/chat/lib/canonical.test.ts src/shared/lib/db/guest-conversations.test.ts
```

### Advisory conformance review
`$openspec-review-conformance chat-turn-persistence` is advisory rather than proof.

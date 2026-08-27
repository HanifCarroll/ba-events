# Telegram Private Chat Specification

## Purpose
Define the anonymous private-chat Telegram adapter, durable delivery, identity protection, deletion, and retention boundaries.

## Requirements

### Requirement: Telegram accepts private supported updates only
The webhook MUST authenticate its secret, bound the update payload, and ignore unsupported or group messages. Duplicate update IDs MUST NOT create duplicate turns.

#### Scenario: Same update arrives twice
- **WHEN** Telegram retries one update id
- **THEN** it resolves to one durable delivery item and one logical turn

### Requirement: Raw identity is not retained in worker metadata
Raw Telegram IDs, usernames, names, and message payloads MUST NOT be stored as retained Durable Object metadata. Stable identity SHALL use a keyed digest and transient handoff SHALL use an encrypted envelope.

#### Scenario: Worker acknowledges an update
- **WHEN** the encrypted handoff is stored
- **THEN** retained routing metadata contains only opaque identifiers and delivery state

### Requirement: Delivery is ordered and retry bounded
Each conversation SHALL process its inbox head in order, honor Telegram retry guidance, and retry terminal work only within the declared bound.

#### Scenario: Telegram responds with retry_after
- **WHEN** a send is rate limited
- **THEN** delivery waits for the supplied interval before retrying

### Requirement: Completion and deletion remove decryptability
Successful completion SHALL clear the envelope key. `/delete` SHALL remove the conversation and identity link and clear keys from prior delivery claims; retained nonidentifying delivery state remains subject to bounded retention.

#### Scenario: User deletes the conversation
- **WHEN** `/delete` completes
- **THEN** prior payloads can no longer be decrypted or linked through the stored identity digest

## Verification

### Implementation anchors
- `src/features/telegram/webhook.server.ts`
- `src/features/telegram/envelope.server.ts`
- `src/features/telegram/delivery.server.ts`
- `src/features/telegram/identity.server.ts`
- `src/telegram-worker/index.ts`

### Deterministic tests
- `src/features/telegram/webhook.server.test.ts`
- `src/features/telegram/envelope.server.test.ts`
- `src/features/telegram/delivery.server.test.ts`
- `src/features/telegram/identity.server.test.ts`
- `src/telegram-worker/index.test.ts`

### Verification command
```sh
bunx vitest run src/features/telegram/webhook.server.test.ts src/features/telegram/envelope.server.test.ts src/features/telegram/delivery.server.test.ts src/features/telegram/identity.server.test.ts src/telegram-worker/index.test.ts
```

### Advisory conformance review
`$openspec-review-conformance telegram-private-chat` is advisory rather than proof.

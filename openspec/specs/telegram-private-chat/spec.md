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

### Requirement: Bot API delivery honors caller cancellation
Telegram turns SHALL own a scoped cancellation signal and propagate it into final messages, callback answers, typing refreshes and progress drafts. Bot API delivery calls SHALL accept that owning cancellation signal. Cancellation SHALL stop waiting and reach the underlying fetch during both request and response-body consumption, while retaining the existing ten-second timeout and Telegram error redaction and retry metadata.

#### Scenario: Delivery is cancelled before or during a request
- **WHEN** a delivery caller cancels before a request or while its request or response body is pending
- **THEN** an already-cancelled call starts no fetch, an active fetch receives cancellation, and a late successful response is not accepted

#### Scenario: Turn is interrupted during delivery or progress
- **WHEN** a turn is interrupted while final delivery, typing or a progress draft is pending
- **THEN** active Bot API requests receive cancellation, queued or late progress starts no new delivery, and the interrupted turn does not mark its durable claim completed

### Requirement: Turn storage requests honor interruption
External conversation reads and writes and Telegram delivery-claim operations SHALL propagate their owning Effect interruption signal to the actual database transport. An interrupted operation SHALL NOT advance to a subsequent repository step. Cancellation does not undo a database write that has already committed.

#### Scenario: A storage request is pending when the turn is interrupted
- **WHEN** interruption arrives during an external conversation read, message RPC, metadata write, deletion, envelope lookup or completion marker
- **THEN** the pending database request receives cancellation and the interrupted program starts no subsequent request

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
- `src/features/telegram/client.test.ts`
- `src/features/telegram/turn.test.ts`
- `src/features/telegram/storage-cancellation.test.ts`
- `src/telegram-worker/index.test.ts`

### Verification command
```sh
bunx vitest run src/features/telegram/client.test.ts src/features/telegram/turn.test.ts src/features/telegram/storage-cancellation.test.ts src/features/telegram/webhook.server.test.ts src/features/telegram/envelope.server.test.ts src/features/telegram/delivery.server.test.ts src/features/telegram/identity.server.test.ts src/telegram-worker/index.test.ts
```

### Advisory conformance review
`$openspec-review-conformance telegram-private-chat` is advisory rather than proof.

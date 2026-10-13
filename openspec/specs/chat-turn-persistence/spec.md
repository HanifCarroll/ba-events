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

#### Scenario: A terminal write uses an expired or failed claim
- **WHEN** an attempt tries to complete or fail a turn without a running, unexpired claim
- **THEN** no assistant message or terminal state is written
- **AND** replay of an already completed turn by its completing claim returns the existing result without changing it

### Requirement: Guest response persistence and completion are atomic
Guest completion SHALL validate the claim, save the server-produced canonical assistant response under the turn's fixed message identifiers, and mark the turn completed in one IndexedDB transaction. Rejected completion SHALL leave both messages and turn state unchanged. Ordinary message writes SHALL NOT replace a turn-owned assistant response.

#### Scenario: An older guest attempt finishes after a retry
- **WHEN** a newer claim owns or has completed the turn
- **THEN** the older attempt cannot save or overwrite its assistant response

### Requirement: Browser callbacks belong to one request attempt
Each attempt SHALL capture its conversation, authenticated identity, turn, claim, and message identifiers. Only the current attempt MAY update current chat UI state. Errors, cancellation, disconnection, and streams without a complete canonical response SHALL NOT be treated as successful completion. Retrying SHALL preserve the original turn and message identifiers.

#### Scenario: The stream reports an error followed by finish
- **WHEN** the SDK invokes both error and finish callbacks for one attempt
- **THEN** failure is handled once and no success bookkeeping or assistant persistence runs

#### Scenario: Conversation changes while an old request finishes
- **WHEN** the user navigates or changes authenticated identity before an earlier attempt settles
- **THEN** its callbacks cannot change the new conversation's messages, retry state, or request phase

#### Scenario: Cached authenticated history belongs to a previous account
- **WHEN** the active account or conversation differs from the loaded history's owner or conversation identifier
- **THEN** its messages and pending turns are not rendered or submitted

#### Scenario: Another tab completed a guest turn before its retry
- **WHEN** retry finds the turn already completed
- **THEN** the saved reply is rendered without another provider request or assistant write

#### Scenario: Old message outbox items remain after migration
- **WHEN** an authenticated browser reconnects with existing queued messages
- **THEN** those items retain their recovery path while new submissions use durable turns

### Requirement: Users can stop and retry an unfinished response
The chat SHALL expose an accessible, localized Stop control during preparation and response generation. Stopping SHALL preserve the user message and original turn identifiers, prevent partial assistant persistence and success bookkeeping, and expose an explicit Retry action. Once canonical persistence begins, Stop SHALL no longer be available and SHALL NOT undo completion.

#### Scenario: User stops while the response is running
- **WHEN** the user activates Stop before canonical persistence begins
- **THEN** the browser aborts its SDK request and shows a localized stopped notice with Retry
- **AND** late completion callbacks cannot persist an assistant reply or report success
- **AND** Retry reuses the original turn and user and assistant message identifiers

#### Scenario: User stops during preparation
- **WHEN** the user activates Stop before bootstrap or claim completes
- **THEN** the old attempt cannot start a provider request after preparation settles
- **AND** any late running guest claim is released without losing the retry path

### Requirement: Chat feedback and input are accessible in the active locale
The composer SHALL have a localized accessible name and SHALL NOT submit Enter while text composition is active. Errors and retry guidance SHALL share one nonoverlapping notice in normal document flow with localized controls. Failures SHALL be announced as alerts using generic user-facing text; intentional stops SHALL be announced as status updates.

#### Scenario: Response fails on a narrow screen
- **WHEN** the response fails and Retry is available
- **THEN** the error and Retry appear together without covering the conversation or composer
- **AND** the notice is announced and all controls have localized accessible names

#### Scenario: User confirms composed text
- **WHEN** Enter is pressed during IME composition
- **THEN** the composer retains the draft without sending a message

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
- `src/features/chat/lib/turn-lifecycle.ts`
- `src/features/chat/components/ChatContainer.svelte`
- `src/features/chat/components/ChatInput.svelte`
- `src/features/chat/components/MessageList.svelte`

### Deterministic tests
- `src/features/chat/api/turns.server.test.ts`
- `src/features/chat/api/turn-authority.test.ts`
- `src/features/chat/api/chat-durability.test.ts`
- `src/features/chat/lib/canonical.test.ts`
- `src/shared/lib/db/guest-conversations.test.ts`
- `src/features/chat/lib/turn-lifecycle.test.ts`

### Verification command
```sh
bunx vitest run src/features/chat/api/turns.server.test.ts src/features/chat/api/turn-authority.test.ts src/features/chat/api/chat-durability.test.ts src/features/chat/lib/canonical.test.ts src/features/chat/lib/turn-lifecycle.test.ts src/shared/lib/db/guest-conversations.test.ts
```

Run `supabase/tests/chat-turn-completion.sql` with `psql -v ON_ERROR_STOP=1 -f supabase/tests/chat-turn-completion.sql` against an empty disposable PostgreSQL database. It exercises the completion migration, invalid claims, rollback and idempotent replay without accessing production.

Run `bun scripts/check-chat-lifecycle-browser.mjs` with Chrome installed for component-level submission, retry, completed replay, history ownership and cancellation checks. The harness compiles the real chat component and uses the real SDK and guest store, with stubbed auth/server responses and child UI. All network requests are intercepted; no development server or production access is needed.

### Advisory conformance review
`$openspec-review-conformance chat-turn-persistence` is advisory rather than proof.

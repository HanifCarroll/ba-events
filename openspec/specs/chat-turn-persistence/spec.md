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

#### Scenario: Stop arrives before the delayed submission
- **WHEN** Stop reaches delivery before its original submission
- **THEN** delivery records cancellation and the delayed submission cannot start generation

#### Scenario: Stop races canonical persistence
- **WHEN** Stop and the persistence gate race for the same attempt
- **THEN** one serialized decision determines whether cancellation or persistence wins
- **AND** the browser waits for that decision before treating terminal callbacks as stopped or completed

### Requirement: Delivery reconnects to the same bounded attempt
The web channel SHALL keep a workflow-owned attempt independent of browser subscribers and a bounded ordered replay log for ten minutes. Browser reconnection SHALL reuse stable identifiers without another provider call or claim acquisition. Attachment, cancellation, deduplication and recovery credentials SHALL preserve the original attempt's identity and authority.

#### Scenario: A browser attaches, stops or repeats a submission
- **WHEN** a browser attaches to, stops or repeats an existing delivery attempt
- **THEN** every attach and Stop revalidate the current identity and an unguessable capability
- **AND** duplicate submissions are deduplicated; changed input, identity or capability is rejected
- **AND** raw capabilities and session credentials do not enter the durable log
- **AND** recovery credentials may be stored in a separate authenticated encrypted envelope, bound to the attempt and deleted at termination or expiry

#### Scenario: A browser connection drops midway through a response
- **WHEN** its connection ends without a terminal delivery event
- **THEN** the client reconnects from the last complete event offset and ignores duplicate prefix events
- **AND** the existing producer and turn claim continue independently
- **AND** previews never cause assistant persistence or success bookkeeping

#### Scenario: The page is refreshed or the user returns to the conversation
- **WHEN** the same browser session retains a valid attempt capability and the owning turn remains eligible
- **THEN** it can replay and attach to that attempt under its original identifiers
- **AND** changing accounts cannot attach to the previous account's delivery

#### Scenario: A runtime restarts during generation
- **WHEN** a runtime interruption prevents completion of the generation workflow step
- **THEN** bounded workflow recovery MAY rerun interrupted read-only generation under the original turn, attempt and unexpired claim
- **AND** a monotonically increasing execution fence rejects stale checkpoint, commit and publication writes
- **AND** the ordered replay prefix remains available and recovery cannot acquire or extend turn ownership
- **AND** recovered artifacts still come only from validated successful reads

#### Scenario: A runtime restarts before workflow admission is confirmed
- **WHEN** the bounded request is durable but workflow creation has not been confirmed
- **THEN** an alarm reconciles admission using the original workflow ID
- **AND** recovery neither creates a second attempt nor depends on the browser staying connected

#### Scenario: A runtime restarts during final persistence or publication
- **WHEN** a validated final response is already checkpointed
- **THEN** recovery reuses that checkpoint without another provider call
- **AND** the original claim and current authenticated identity are revalidated before authoritative persistence
- **AND** final text, canonical response, execution trace and finish are atomically added to the durable replay log exactly once
- **AND** Stop remains serialized against the persistence gate

#### Scenario: Recovery exhausts its budget or ownership expires
- **WHEN** generation exceeds its original ninety-second budget, publication exceeds its twenty-second budget, the original claim is no longer eligible, or recovery retries are exhausted
- **THEN** the attempt fails closed and retains explicit Retry under the original turn identifiers
- **AND** generation plus publication never extends beyond the original two-minute claim

#### Scenario: The replay window expires
- **WHEN** the ten-minute replay window expires
- **THEN** response content and recovery credentials are removed while a small tombstone prevents delayed duplicate submission from rerunning the attempt

#### Scenario: User leaves the page without activating Stop
- **WHEN** navigation or account changes detach the browser subscriber
- **THEN** the server attempt continues independently and old callbacks cannot update the new view
- **AND** guest completion on later replay still requires the original unexpired local claim

### Requirement: Chat feedback and input are accessible in the active locale
The composer SHALL have a localized accessible name and SHALL NOT submit Enter while text composition is active. Errors and retry guidance SHALL share one nonoverlapping notice in normal document flow with localized controls. Failures SHALL be announced as alerts using generic user-facing text; intentional stops SHALL be announced as status updates.

#### Scenario: Response fails on a narrow screen
- **WHEN** the response fails and Retry is available
- **THEN** the error and Retry appear together without covering the conversation or composer
- **AND** the notice is announced and all controls have localized accessible names
- **AND** when the owning user question is visible, its notice and Retry appear directly below that question inside the conversation, rather than above the chat

#### Scenario: User stops a follow-up after an earlier completed response
- **WHEN** the user stops the follow-up response
- **THEN** the stopped notice and Retry appear directly below the follow-up question
- **AND** the feedback is a compact, right-aligned text row with a short localized status and icon-labeled Retry, without a filled notice box or dismiss control
- **AND** Retry retains a minimum forty-four-pixel touch target and visible keyboard focus
- **AND** earlier questions and responses remain unchanged
- **AND** Retry preserves the original turn and message identifiers

#### Scenario: User confirms composed text
- **WHEN** Enter is pressed during IME composition
- **THEN** the composer retains the draft without sending a message

### Requirement: Canonical responses are stored without reconstruction
New assistant messages MUST persist the server-produced canonical response, visible text, contract version, and sanitized execution trace. Guest and authenticated storage MUST NOT reconstruct canonical artifacts from client callbacks.

#### Scenario: A completed turn is reloaded
- **WHEN** history is read later
- **THEN** the stored canonical response remains the rendering authority

### Requirement: Completed web responses collect optional helpfulness feedback
Completed web assistant responses SHALL offer localized, accessible Helpful and Not helpful controls. Progressive, streaming, stopped, failed, or not-yet-persisted responses SHALL NOT offer a rating. Ratings SHALL NOT mutate canonical responses, saved-event membership, or retry state. The browser SHALL retain up to 200 selections in session storage when available; unavailable storage or analytics SHALL NOT disrupt chat.

#### Scenario: A completed response comes into view
- **WHEN** the feedback controls for a completed canonical response enter the viewport
- **THEN** an eligible analytics session records a feedback offer without assuming satisfaction
- **AND** the controls have localized accessible names and pressed states

#### Scenario: A person corrects their rating
- **WHEN** a person selects Not helpful after previously selecting Helpful
- **THEN** the selection changes and an eligible analytics session records the new and previous ratings under the same response identifier
- **AND** repeated selection of the current rating or a remount within the retained browser session does not create another vote
- **AND** session storage retains the latest 200 selections and visible offers across reloads, independently for each opaque response identifier

#### Scenario: A response is interrupted or persistence fails
- **WHEN** a response is still streaming, stopped, or waiting for successful canonical persistence
- **THEN** no feedback controls or feedback analytics are emitted for that unfinished response

#### Scenario: Browser storage or analytics is unavailable
- **WHEN** a person rates a completed reply while storage or analytics is unavailable
- **THEN** the current view shows the selected rating without interrupting chat
- **AND** analytics is best effort and does not claim durable submission

### Requirement: Helpfulness and engagement analytics use limited correlated metadata
Analytics SHALL record visible feedback offers separately from explicit ratings. Feedback events SHALL contain only an opaque canonical response identifier, response kind, event count, locale, and selected/previous ratings. Completed replies and their card interactions SHALL share the response identifier. Custom feedback analytics SHALL honor Do Not Track and Global Privacy Control. Ratings SHALL NOT be forwarded to Google Analytics.

#### Scenario: A person interacts with a rated reply's card
- **WHEN** a card click, successful save or unsave, or external-link click belongs to a completed chat response
- **THEN** its analytics event includes the same opaque canonical response identifier as the helpfulness rating
- **AND** neither feedback event includes chat text, feedback text, source content, or credentials
- **AND** opening its event details preserves attribution only for that event in browser navigation state, without adding the response identifier to any URL
- **AND** opening unrelated details clears inherited attribution

#### Scenario: A person opts out of analytics
- **WHEN** Do Not Track or Global Privacy Control is enabled
- **THEN** selecting a helpfulness rating updates the current view without emitting custom analytics

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
- `src/features/chat/components/ResponseFeedback.svelte`
- `src/features/chat/lib/response-feedback.ts`
- `src/chat-delivery-worker/index.ts`
- `src/features/chat/api/delivery.server.ts`
- `src/features/chat/api/execute.server.ts`
- `src/features/chat/lib/delivery.ts`

### Deterministic tests
- `src/chat-delivery-worker/index.test.ts`
- `src/features/chat/lib/delivery.test.ts`
- `src/features/chat/api/turns.server.test.ts`
- `src/features/chat/api/turn-authority.test.ts`
- `src/features/chat/api/chat-durability.test.ts`
- `src/features/chat/lib/canonical.test.ts`
- `src/shared/lib/db/guest-conversations.test.ts`
- `src/features/chat/lib/turn-lifecycle.test.ts`
- `src/features/chat/lib/response-feedback.test.ts`

### Verification command
```sh
bunx vitest run src/features/chat/api/turns.server.test.ts src/features/chat/api/turn-authority.test.ts src/features/chat/api/chat-durability.test.ts src/features/chat/lib/canonical.test.ts src/features/chat/lib/turn-lifecycle.test.ts src/shared/lib/db/guest-conversations.test.ts
```

Run `supabase/tests/chat-turn-completion.sql` with `psql -v ON_ERROR_STOP=1 -f supabase/tests/chat-turn-completion.sql` against an empty disposable PostgreSQL database. It exercises the completion migration, invalid claims, rollback and idempotent replay without accessing production.

Run `bun scripts/check-chat-lifecycle-browser.mjs` with Chrome installed for component-level submission, retry, completed replay, history ownership and cancellation checks. The harness compiles the real chat component and uses the real SDK and guest store, with stubbed auth/server responses and child UI. All network requests are intercepted; no development server or production access is needed.

### Advisory conformance review
`$openspec-review-conformance chat-turn-persistence` is advisory rather than proof.

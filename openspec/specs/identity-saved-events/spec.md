# Identity and Saved Events Specification

## Purpose
Define authenticated account boundaries and the user-scoped saved-event surface.

## Requirements

### Requirement: Session identity is server-derived
Authenticated operations MUST derive the active user from the server session. Client-supplied user identifiers MUST NOT authorize access to another account.

#### Scenario: Client names another user
- **WHEN** an account or saved-event request includes a foreign user id
- **THEN** the operation remains scoped to the authenticated session or is denied

### Requirement: Saved membership is user scoped
Save, unsave, list, and membership reads MUST affect only the authenticated user's records and MUST require a displayable event.

#### Scenario: User saves the same event twice
- **WHEN** the save operation is repeated
- **THEN** membership remains one logical saved event

#### Scenario: Guest asks for saved events
- **WHEN** no authenticated user exists
- **THEN** no private saved-event list is exposed

### Requirement: Chat does not mutate saved membership
The concierge MAY read saved membership and show the appropriate heart control, but MUST NOT expose a chat mutation tool.

#### Scenario: Chat receives an unsave request
- **WHEN** the target resolves successfully
- **THEN** chat returns event detail guidance and leaves membership unchanged

### Requirement: Account deletion is session scoped
Account deletion MUST require the authenticated account and MUST NOT trust a mismatched client user identifier.

#### Scenario: Deletion request names another account
- **WHEN** the supplied identifier differs from the session user
- **THEN** deletion is denied

### Requirement: Saved controls preserve localized accessible names
Save controls SHALL use the active UI locale. When a saved control has visible text, its accessible name SHALL include that text and describe the remove action.

#### Scenario: A signed-in user sees a labeled saved control
- **WHEN** a saved event card renders in English or Spanish with its saved label visible
- **THEN** its accessible name includes the localized saved label and remove action
- **AND** its pressed state indicates saved membership

## Verification

### Implementation anchors
- `src/features/auth/api/session.server.ts`
- `src/features/auth/api/server.server.ts`
- `src/features/chat/api/user-tools.server.ts`
- `src/features/chat/api/tools/list-saved-events.ts`
- `src/routes/saved/+page.server.ts`
- `src/features/events/components/SaveEventButton.svelte`

### Deterministic tests
- `src/features/chat/api/agent/orchestrate.test.ts`
- `src/features/chat/api/agent/shared-turn.server.test.ts`
- `src/features/events/components/EventCard.stories.ts` (Chromium stories and accessibility checks in both locales)

### Verification command
```sh
bunx vitest run src/features/chat/api/agent/orchestrate.test.ts src/features/chat/api/agent/shared-turn.server.test.ts
bun run test:storybook
```

### Advisory conformance review
`$openspec-review-conformance identity-saved-events` should report missing deterministic evidence for uncovered auth or mutation scenarios; it is advisory rather than proof.

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
Save, unsave, list, and membership reads MUST affect only the authenticated user's records and MUST require a displayable event. On a Worker that binds D1 they MUST run on the server (`/api/saved` for the browser), which filters every read and write by the session user, because D1 has no row-level security; without D1 the browser's Supabase calls stay, under row-level security. A request that names an expected user other than the session user MUST be refused with 409 and change nothing.

#### Scenario: Another user's saved rows
- **WHEN** user B lists, checks, saves, or unsaves an event user A saved
- **THEN** B sees none of A's rows and A's saved events are unchanged

#### Scenario: Session changed under the page
- **WHEN** a saved-event request names an expected user that is not the session user
- **THEN** the server answers 409 and writes nothing

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

### Requirement: Sign-in follows the Worker's backend
A Worker without a D1 binding MUST sign people in through Supabase Auth. A Worker that binds D1 MUST sign people in through Better Auth with a one-time magic link, sent from a `baeventos.com` address in the sign-in page's language, and with Google, and MUST sign nobody in when its auth secret is missing. A Google sign-in MUST join an existing account only when Google reports the email verified; an unverified Google email MUST NOT be linked or signed in. A tab MUST pick up a sign-in or sign-out from another tab when it is next focused or shown. Admin access MUST come from `profiles.role`. While the Worker's `DB_READ_ONLY` is `1`, sign-in and sign-out MUST keep working and every other account write (saving, profile changes, deletion) MUST answer 503 and change nothing.

#### Scenario: Magic link used twice
- **WHEN** a magic link that already signed someone in is opened again
- **THEN** the callback reports an invalid token and no session is created

#### Scenario: Google reports the email unverified
- **WHEN** a Google identity with an existing account's email arrives with `email_verified` false
- **THEN** no account is linked and no session is created

#### Scenario: Unknown Google email arrives unverified
- **WHEN** a Google identity whose email matches no account arrives with `email_verified` false
- **THEN** no user, account, or session is created

#### Scenario: Imported user signs in
- **WHEN** a user copied from Supabase signs in on D1
- **THEN** their session carries their Supabase user id, so their profile, saved events, preferences, and conversations are theirs

### Requirement: Account deletion is session scoped
Account deletion MUST require the authenticated account and MUST NOT trust a mismatched client user identifier.

#### Scenario: Deletion request names another account
- **WHEN** the supplied identifier differs from the session user
- **THEN** deletion is denied

#### Scenario: Deletion request without a session
- **WHEN** nobody is signed in, on either backend
- **THEN** deletion is denied and no account is deleted

### Requirement: Saved controls preserve localized accessible names
Save controls SHALL use the active UI locale. When a saved control has visible text, its accessible name SHALL include that text and describe the remove action.

#### Scenario: A signed-in user sees a labeled saved control
- **WHEN** a saved event card renders in English or Spanish with its saved label visible
- **THEN** its accessible name includes the localized saved label and remove action
- **AND** its pressed state indicates saved membership

### Requirement: Browser state belongs to the active identity
Profile hydration, profile mutation refreshes, saved membership, saved-list loads, and conversation-history loads MUST discard results from a replaced identity or disposed view. An identity change MUST clear data belonging to the previous account before accepting new results. Browser requests that capture an expected identity MUST reject if the resolved session has changed.

#### Scenario: Account changes while a profile or saved list is loading
- **WHEN** a request for account A completes after the browser switches to account B or signs out
- **THEN** the old result does not populate the current profile, membership control, saved list, or conversation history

#### Scenario: A saved membership write fails
- **WHEN** an optimistic save or unsave fails for the current control
- **THEN** the control restores its last confirmed membership and permits another attempt
- **AND** membership hydration completes before a toggle can start

#### Scenario: Saved-event loading fails
- **WHEN** a saved-event database read fails
- **THEN** the UI represents failure separately from a successful empty list and permits retry

#### Scenario: Same-account token refresh overlaps a profile save
- **WHEN** session refresh reads the old profile before a pending display-name write finishes
- **THEN** the mutation's post-write refresh is still accepted for that identity
- **AND** signing out or replacing the identity still invalidates the old mutation refresh

### Requirement: Browser authentication and mutation attempts have one owner
Sign-in, callback verification, profile saves, and account deletion MUST have explicit mutually exclusive phases. Repeated submissions while an attempt is running MUST NOT start duplicate work. Disposing a view MUST prevent its asynchronous completion from updating that view or redirecting it. Account deletion and its sign-out cleanup MUST be owned by the browser session and MUST continue when the profile view is disposed; remounting that view MUST reconnect to the same per-account attempt.

#### Scenario: Sign-in methods overlap
- **WHEN** the user starts a magic-link request and then attempts Google sign-in before it settles
- **THEN** only the first request runs and the confirmation retains the submitted email

#### Scenario: Profile view unmounts during account deletion
- **WHEN** the user leaves the profile view while the deletion request is running
- **THEN** successful deletion still proceeds to sign-out cleanup
- **AND** remounting the profile view observes the existing attempt instead of starting another deletion
- **AND** completion neither redirects a replacement account nor moves a user who left the profile route

#### Scenario: Account deletion succeeds but sign-out fails
- **WHEN** deletion has succeeded and browser sign-out fails
- **THEN** retry resumes sign-out without repeating account deletion
- **AND** cleanup does not sign out a different account that became active meanwhile

## Verification

### Implementation anchors
- `src/features/auth/api/session.server.ts`
- `src/features/auth/api/server.server.ts`
- `src/features/auth/api/better-auth.server.ts`
- `src/features/auth/api/magic-link-email.server.ts`
- `src/features/auth/api/user-store.server.ts`
- `src/routes/api/auth/[...path]/+server.ts`
- `src/routes/api/saved/+server.ts`
- `migrations/0004_better_auth.sql`
- `scripts/d1-migrate/users.ts`
- `src/features/chat/api/user-tools.server.ts`
- `src/features/chat/api/tools/list-saved-events.ts`
- `src/routes/saved/+page.server.ts`
- `src/features/events/components/SaveEventButton.svelte`
- `src/features/auth/hooks/{auth,sign-in,profile}.machine.ts`
- `src/features/auth/hooks/account-deletion.ts`
- `src/features/events/lib/{saved-membership,saved-list}.machine.ts`

### Deterministic tests
- `src/features/auth/api/better-auth-d1.server.test.ts` (magic link, Google linking, sessions, cross-user checks, `/api/saved`, and the user import on Miniflare D1)
- `src/features/auth/api/supabase-boundary.test.ts` (without D1, every account path stays on Supabase)
- `src/features/auth/hooks/better-auth-session-sync.test.ts` (another tab's sign-in and sign-out, and account deletion clearing the state)
- `src/features/auth/hooks/identity-machines.test.ts`
- `src/features/auth/hooks/account-deletion.test.ts`
- `src/features/events/lib/saved-machines.test.ts`
- `src/features/chat/api/agent/orchestrate.test.ts`
- `src/features/chat/api/agent/shared-turn.server.test.ts`
- `src/features/events/components/EventCard.stories.ts` (Chromium stories and accessibility checks in both locales)

### Verification command
```sh
bunx vitest run src/features/auth/api/better-auth-d1.server.test.ts src/features/chat/api/agent/orchestrate.test.ts src/features/chat/api/agent/shared-turn.server.test.ts
bun run test:storybook
```

### Advisory conformance review
`$openspec-review-conformance identity-saved-events` should report missing deterministic evidence for uncovered auth or mutation scenarios; it is advisory rather than proof.

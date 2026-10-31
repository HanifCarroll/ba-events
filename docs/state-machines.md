# State machines

XState 6.0.0-alpha.71 and `@xstate/svelte` 6.0.0-alpha.4 make event-driven lifecycles explicit.
Each feature owns its machine. There is no application-wide actor system.

Both dependencies are pinned exactly while XState 6 is in alpha. Machines use
the v6 schema maps, inline transition functions and async actor APIs. Consult
the version-matched guides in `node_modules/xstate/docs/` before upgrades; this
code does not depend on v5 compatibility wrappers or persisted XState snapshots.

## Ownership

- Svelte components use `useMachine`; component destruction stops invoked work
  and timers. Account and resource changes exit the old invocation so late
  completions cannot update a replacement view. Promise cancellation suppresses
  stale completion; it does not roll back a server write already in progress.
- Nullable async reads return an explicit result object, preserving missing
  records across the v6 async actor boundary.
- Account deletion uses a browser-scoped controller per account. Leaving the
  profile page detaches its observer while deletion and sign-out cleanup continue.
  Cleanup retries never repeat deletion or sign out a replacement account.
- Native speech, fetch and platform callbacks stay at their existing adapters.
  Fetch cancellation is forwarded when supported. Speech actor exit detaches
  callbacks and aborts its recognizer.
- Server policies use pure XState transitions inside the existing Effect or
  platform operation. They create no additional timers, retry scheduler or
  global Effect runtime.
- Durable Object storage, SQL claims, IndexedDB transactions and Trigger
  checkpoints remain authoritative. The durable delivery policy is restored
  from existing metadata on each serialized operation. XState snapshots are
  not persisted as a second server-side format.

## Audit coverage

The original audit identified 21 opportunities. This table distinguishes the
XState adoption from findings that require a different kind of change.

| # | Opportunity | Implementation or disposition |
| --- | --- | --- |
| 1 | Event enrichment readiness | Keep the Effect pipeline. Description, translation, facets and embedding readiness are independent persisted facts. Correcting their conflation requires an enrichment data/selection change; an actor would not repair it. |
| 2 | Enrichment batch chain | Keep Trigger as workflow owner. Unknown counts, transactional audit updates and chain identity need repository and durable orchestration changes. No second XState scheduler. |
| 3 | Event publication and timing | Keep database authority. Publication approval and calendar status need separate domain fields and compatible SQL/read changes, rather than a process-local machine. |
| 4 | Venue review and settlement | Keep Effect orchestration and database authority. Approval/repoint atomicity and uncertain matches require transaction and domain changes. |
| 5 | Telegram final send | Keep the existing durable claims and Effect graph. Confirmed, rejected and uncertain external sends need provider receipts/reconciliation; XState alone cannot establish delivery or exactly-once sending. |
| 6 | Browser chat attempt | `features/chat/lib/turn-lifecycle.machine.ts`: preparation, thinking, persistence, Stop negotiation, saving, completed, failed, detached and cancelled. `ChatContainer` derives request phase from the snapshot. |
| 7 | Durable web execution | `chat-delivery-worker/lifecycle.ts`: guarded checkpoint, commit, canonical publication, completion, failure and cancellation. Admission, execution fences and Workflow recovery retain their platform implementation. |
| 8 | Authentication hydration | `features/auth/hooks/auth.machine.ts`: anonymous, loading profile, authenticated and unavailable profile. SSR instances are request-local; browser session changes invalidate old profile actors. |
| 9 | Browser reconnect | `features/chat/lib/delivery.machine.ts`: connection and replay retries, ordered offsets, completion, cancellation and bounded failure. Reconnect never retries model generation. |
| 10 | Telegram inbox | `telegram-worker/inbox-lifecycle.ts`: processing, retry wait, exhaustion, acknowledgement and completion. A durably acknowledged item retries cleanup without processing again. |
| 11 | Account/conversation deletion | `features/auth/hooks/profile.machine.ts` and `account-deletion.ts`: account deletion and sign-out cleanup are separate stages that outlive route navigation; cleanup retry does not repeat deletion. Telegram deletion/redaction still needs database recovery guarantees and stays in its Effect graph. |
| 12 | Saved-event membership | `features/events/lib/saved-membership.machine.ts`: identity-scoped loading, ready, updating and read failure. Initial loading cannot overwrite a newer toggle; identity changes invalidate old callbacks. |
| 13 | Agent search policy | `features/chat/api/agent/search-lifecycle.ts`: one active search, bounded retry constraints and successful-search lockout. Attempt identity rejects late outcomes after cancellation. |
| 14 | Browser-resource ownership | `shared/lib/browser/release.ts`: owned, releasing, unconfirmed and released. Concurrent closes share work; failed verification permits later cleanup; confirmed release is terminal. Acquisition caches and lane serialization remain unchanged. |
| 15 | Legacy browser message outbox | `features/chat/lib/persistence-outbox.machine.ts`: persistence and local cleanup are distinct stages. IndexedDB records successful persistence before deletion so cleanup recovery can avoid another remote write. |
| 16 | Voice recognition | `features/chat/lib/speech.machine.ts` and `speech.svelte.ts`: shared preparation, recognition, stopping, fallback, failure and disposal lifecycle for composer and landing input. |
| 17 | Sign-in and callback | `features/auth/hooks/sign-in.machine.ts`: sending a link, link sent, OAuth redirect, verification and failure are explicit. |
| 18 | User-scoped reads | Saved lists, conversation history and guest conversation loading have invoked request lifecycles. Identity replacement clears old data and drops stale results; errors remain distinct from successful empty results where the underlying read exposes them. |
| 19 | Feedback/profile forms | `shared/ui/feedback.machine.ts` and `features/auth/hooks/profile.machine.ts`: submission, success, failure and reset/close timers belong to the current invocation. |
| 20 | PWA install | `shared/lib/pwa/install.machine.ts`: available, prompting, accepted awaiting installation, dismissed, failed and installed. A prompt is consumed once; acceptance does not claim installation. |
| 21 | Pull-to-refresh | `shared/hooks/pull-to-refresh.machine.ts`: tracking, armed, refreshing, failure and cancellation, including touch cancellation and failed-refresh cleanup. |

The five retained domain/persistence findings above remain findings, not fixes
claimed by this refactor. Existing SQL/IndexedDB turn claims and the pure scroll
transition model are already explicit and remain in place. Simple UI toggles and
ordinary derived values do not need an actor.

## Compatibility and tests

Telegram inbox rows gain an optional `phase: 'acknowledging'`. Older rows default
to processing; older workers can read new rows but ignore the cleanup-only
optimization and rely on the existing durable turn claims. The legacy browser
message outbox records a `persisted` cleanup state using its existing IndexedDB
store and indexes. Neither change requires a server database migration. An old
browser does not flush the new cleanup-only rows; a new browser finishes them.
Uncertain remote writes still rely on the existing stable client identifiers
and server idempotency, rather than a claim of exactly-once networking.

Regression tests exercise stale requests, simultaneous events, duplicate
callbacks, cancellation, retry bounds and cleanup failure using synthetic
fixtures. The real SDK/IndexedDB chat browser harness and Storybook interactions
cover the component wiring. Run `bun run cloudflare:ci`, `bun run build`,
`bun run test:storybook` and `bun run chat:browser`; compile/build checks use the
placeholder public settings in [getting-started.md](getting-started.md).

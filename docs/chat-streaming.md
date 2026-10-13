# Chat streaming and response contract

Web chat uses the installed Vercel AI SDK and Svelte Chat client. The bounded
ToolLoopAgent streams model text internally. After successful reads and text
updates, the same canonical assembler used at completion produces transient
`data-progress` snapshots. Small `data-progress-text` updates change prose,
validated framing and reasons, never artifact membership or facts. No model
reasoning, raw tool results or reference bookkeeping reach the browser.
Recommendation framing retains whole-response validation; cards can appear
before framing is ready.

The final v5 wire contract remains one final text block, exactly one persistent
`data-response` and a sanitized transient reads-only execution trace. Previews
are neither stored messages nor completion. Authenticated persistence must
succeed before final delivery. Guest completion requires the complete SDK finish
and the original running, unexpired IndexedDB claim in its atomic transaction.

The agent uses DeepSeek through `ToolLoopAgent`, `stopWhen: isStepCount(5)`, a
60-second total / 20-second step bound, a seven-second per-tool bound, and one
retry. It receives the latest user request, bounded recent visible
user/assistant DATA, and server-rehydrated prior/pinned facts. It may chain
tools until it writes final prose. It never receives mutation tools. If a final
model step times out after successful reads, the server preserves those
canonical artifacts with deterministic fallback text; failures without a
successful read return the deterministic error canonical.

`runSharedChatTurn` is the channel-neutral entry point used by both the web API
and Telegram. Authentication, persistence, rate limits, guest debug, and
channel-specific rendering remain outside the agent.

## Delivery ownership

`/api/chat` validates the attempt identity and current account, then forwards to
the `CHAT_DELIVERY` Durable Object binding. One object per turn/attempt owns an
independent service-binding request to `/api/chat/execute`. That execution route
requires a short-lived HMAC authenticated request and rechecks the current user.
Client disconnect does not cancel generation. The private execution endpoint
is not a second public chat entry point.

Events are committed to Durable Object storage before publishing with monotonic
SSE IDs. Delivery lasts ten minutes; the log is limited to 2 MiB, events to
128 KiB, subscribers to four and producer lifetime to 90 seconds.

The client reconnects below the SDK parser using the last complete event ID,
ignores duplicate prefixes and retries transient network loss up to five times
with bounded backoff. A lost initial POST is retried with its exact original
body and identity; the object deduplicates it. Session storage retains a random
256-bit capability per account/conversation for refresh and navigation recovery.
Every attach and Stop revalidates the account and capability; raw capabilities
and cookies never enter the durable log. Terminal attempts clear the browser
capability without deleting a newer attempt.

`/api/chat/{turnId}/stop` serializes against the object's `/commit` gate. Stop
before the gate aborts execution and fails the owning authenticated claim, or
lets the browser release its guest claim. Stop after the gate returns a conflict
and allows canonical completion. An early Stop creates a cancellation record,
so a delayed original POST cannot start later. The browser defers terminal
callbacks until the Stop decision arrives. Navigation detaches without Stop.

This recovers delivery, not a crashed model process. A restarted object replays
its prefix and fails closed without starting another producer. Expired logs are
purged; a small expiry tombstone remains to reject delayed duplicate POSTs.
The tombstone retains no account identity, token/payload hashes or chat content.
Claims are not extended or silently reacquired: guest replay after its two-minute
claim expiry needs explicit retry; authenticated completion still uses database
ownership checks. Telegram retains its existing non-progressive contract.

## Cloudflare deployment

The delivery class is a separate Worker because SvelteKit's Cloudflare adapter
generates the web Worker's entrypoint. `wrangler.chat.jsonc` registers the SQLite
Durable Object and private `CHAT_EXECUTION` service binding; `wrangler.jsonc`
binds the web Worker to that class. Both must have the same strong
`CHAT_DELIVERY_SECRET` configured through Cloudflare secrets. Never commit it or
expose it as a public environment variable.

Configure secrets before deploying this release:

```sh
bunx wrangler secret put CHAT_DELIVERY_SECRET --config wrangler.chat.jsonc
bunx wrangler secret put CHAT_DELIVERY_SECRET --config wrangler.jsonc
```

Deploy delivery before the web Worker. `cloudflare:deploy` includes that order;
`chat:dry-run` validates the bundle without publishing. The delivery Worker's
compatibility date is deliberately `2026-10-01`: Cloudflare's pending I/O
keep-alive prevents eviction during the independent service request. Plain web
Worker `waitUntil` cannot support long generation after a browser disconnect.
Missing binding/secret fails closed; there is no unowned streaming fallback.

## Verification

Worker tests exercise replay, deduplication, account/capability isolation, early
cancellation, commit races, interruption and expiry. Client transport tests use
the real SDK and guest store for truncated-event recovery and atomic completion.
Lifecycle and agent tests cover preview authority, detach and callback races.

The browser harness compiles the real Svelte ChatContainer with the real AI SDK
and IndexedDB as a bounded fixture, without starting the application development
server. Fixture verification and live-model dogfood are reported separately.
`bun run chat:browser` includes a real workerd SQLite delivery test.
`bun run chat:dogfood` builds the production app and tests its real UI with live
DeepSeek and event search, including refresh while previews are visible.
Screenshots and results go outside the repository under
`/tmp/ba-events-chat-dogfood` (override with `CHAT_DOGFOOD_EVIDENCE_DIR`).
Chrome and configured AI/database credentials are required for live dogfood.
The pinned workerd development dependency supports the production compatibility
date; the older runtime bundled inside Wrangler does not.

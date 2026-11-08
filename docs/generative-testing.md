# Generative testing

The suite combines generated business histories, hostile parser inputs, and local HTTP contract generation. It uses the production functions and handlers, with synthetic storage or transport bindings where services are external.

## Workflow coverage

| Workflow | Tool and production boundary | Checked behavior |
| --- | --- | --- |
| Guest chat submission, Stop/failure, retry and completion | fast-check; real Dexie transactions over fake-indexeddb | Stable identifiers; one user message; only the current running claim can save; stale writers cannot overwrite; one canonical reply survives replay; conflicting conversation/content is rejected without changing messages. |
| Delivery ownership, cancellation and reconnect | fast-check; real `ChatDelivery` with synthetic storage/Workflow bindings | Owner and capability checks for both attachment and repeated start; rejected requests leave storage and admission counts unchanged; changed submission rejected; duplicate submissions admit one workflow; Stop before submission prevents admission; cancellation survives object restart; credentials are not stored in plaintext. |
| Search constraints and retries | fast-check; canonicalizer, retry guard, real Supabase/PostgREST serialization against loopback transport | Paid/free/unspecified remain distinct even with conflicting query wording; explicit fields take precedence while recognized spans are consumed; price and age zero survive; categories, neighborhoods and exclusions reach filters; display stays 1–5 and candidates 50; retries cannot drop constraints; filter-only, both count paths, semantic and lexical requests agree. |
| Import occurrence matching | fast-check; candidate decoder and publication planner | Repeated promotion links to the same occurrence; ambiguous matches and missing evidence are held; separately evidenced showtimes stay separate; rescheduling retains identity; tracking parameters do not change ticket identity. |
| Telegram admission and dispatch retries | fast-check; webhook handler with injected persistence/dispatch leaves | Wrong secrets cause no dispatch; completed updates do not dispatch; retries use one stable idempotency key and charge quota once; dispatch failures return retryable status; envelopes preserve text and reject a different update identity. |
| Text, Telegram and chat/import parser boundaries | Jazzer.js; production parsers and envelope functions | Unicode normalization, encryption/tamper checks, private human Telegram updates, strict task/plaintext payloads, chat bootstrap identifiers, import evidence rejection, accepted JSON round trips. |
| Chat streaming/replay frames | Jazzer.js; `ChatEventDecoder` | Arbitrary Unicode payloads and chunk boundaries, including split CRLF, retain exactly one frame and its replay offset. |
| Authenticated chat bootstrap | Schemathesis; actual SvelteKit handler and Supabase client | Valid generated input reaches the local RPC transport and returns a normalized pending turn; malformed input and anonymous sessions never reach persistence. |
| Telegram webhook HTTP | Schemathesis; actual webhook handler | Secret checks, supported and unsupported updates, successful encrypted dispatch, stable queue/update keys and bounded bodies. |
| Delivery HTTP | Schemathesis; actual `ChatDelivery.fetch` | Authorized replay and Stop, wrong owner/capability rejection, changed submission rejection, malformed identity, finite replay event schemas. |
| Anonymous admin API | Schemathesis; actual GET/POST `/api/events` | Anonymous requests remain unauthorized regardless of body. |

`src/shared/lib/workflow-properties.test.ts` and `delivery-workflow-properties.test.ts` hold the generated histories. `tests/fuzz/search-properties.ts` runs in its own process so its synthetic Supabase configuration cannot leak into other tests. Reviewed parser seeds live under `tests/fuzz/corpus/`.

## Run locally

Use Node.js 24, Bun 1.3.14, Python 3.10+ and [uv](https://docs.astral.sh/uv/getting-started/installation/). `mise install` provides the pinned Bun, Node.js and uv.
The lockfile pins `fast-check@4.10.2` and `@jazzer.js/core@4.0.0`. The API runner uses `uvx --from schemathesis==4.32.7`; uv installs it in an isolated cache. For a standalone CLI, run `uv tool install schemathesis==4.32.7`.

```sh
bun install --frozen-lockfile
bun run test:generative   # all three tools
bun run test:property     # 8 unit properties plus isolated search transport property
bun run test:fuzz         # 10,000 coverage-guided Jazzer.js executions
bun run test:api          # 7 HTTP operations, up to 100 examples each plus explicit examples
```

The three original input properties run 500 examples each. Business properties run 60–120 histories/data sets each; a history contains up to 20–30 operations. Search transport runs 120 generated cases plus explicit false/true/unspecified regressions. The dedicated GitHub Actions workflow runs the combined suite and retains reports, generated corpus and failures for seven days. Unit properties also run with the ordinary Vitest/Bun suites; the isolated search transport property runs through `test:property`.

## Isolation and limits

[Jazzer.js](https://github.com/CodeIntelligenceTesting/jazzer.js) is the JavaScript implementation of Jazzer. Bun compiles the TypeScript target and its production dependencies to ESM; Node runs Jazzer instrumentation. Inputs are capped at 4 KiB and five seconds each. This is a bounded campaign, not exhaustive coverage.

The child runner removes inherited database/provider credentials, disables Bun environment-file loading, and accepts no external API URL. HTTP fixtures bind ephemeral ports on `127.0.0.1` and close them after each run. Generated files stay under ignored `tmp/fuzz/`.

The chat bootstrap fixture supplies `locals.user` as SvelteKit authentication hooks would, then exercises the actual route, normalization and Supabase RPC serialization. Its local RPC response validates mapping; **it does not execute PostgreSQL functions, Supabase RLS or session establishment**. Guest persistence properties use actual IndexedDB transactions. Delivery properties use the actual state machine with synthetic durable storage and workflow admission; they do not run Cloudflare infrastructure or model generation. Telegram dependencies model stored delivery claims and Trigger's idempotency contract; no Telegram message is sent.

`/delivery/*` in the test schema represents internal `ChatDelivery.fetch` operations, not additional public routes. Public SvelteKit middleware, browser rendering, login flows, production PostgreSQL/RLS, live provider/reranker quality, admin event creation/enrichment and actual Trigger/Telegram/Cloudflare execution require their existing deterministic, browser or environment checks. These generated tests complement those checks.

Schemathesis checks server errors, status/content/header/schema conformance, plus fixture assertions for dispatch and persistence side effects. Six fixed delivery-start probes require exact-payload replay, wrong-owner/token/payload rejection and malformed-identity rejection; every rejected delivery request must leave durable state and workflow admission unchanged. Both lexical and semantic RPC bodies must preserve generated price, age, category, neighborhood and exclusion constraints. Negative-data rejection is not a universal policy: Telegram acknowledges unsupported updates, chat bootstrap tolerates extra fields, and anonymous admin requests always return 401. Success counters fail the run if authenticated bootstrap, Telegram dispatch or delivery acceptance/rejection paths stop being exercised. The admin operations intentionally retain an authentication warning.

## Reproduce and extend

The default seed is `20261031`. Property failures print their minimized counterexample and replay path. Use `FC_SEED=123 bun run test:property`, or put a reported path into that property's `fc.assert` options for exact replay.

```sh
node scripts/run-fuzz.mjs jazzer -runs=100000 -seed=123
node node_modules/@jazzer.js/core/dist/cli.js tmp/fuzz/target.mjs tmp/fuzz/artifacts/crash-HASH --sync -- -runs=1
```

Promote minimized failures into named regressions and reviewed seeds. Schemathesis keeps its failure database at `tmp/fuzz/hypothesis` and JUnit report at `tmp/fuzz/schemathesis.xml`. Extend the schema and local fixture together, with explicit success and side-effect assertions.

## Verified regression

The generated paid-only case (`isFree: false`, price/age zero) exposed dropped filtering in intent canonicalization, retry checks, filter-only retrieval, both count paths and happening-now results. Those paths now preserve false, true and unspecified separately, matching semantic/lexical retrieval. Named regressions and explicit transport examples retain the failure. The tool descriptions now spell out all three free-status choices. The frozen evaluation corpus was aligned with the same contract.

On 2026-10-31 the expanded focused checks passed: eight unit properties, the isolated search transport property, 10,000 Jazzer executions, and 706 Schemathesis cases across seven operations. The HTTP run exercised successful authenticated bootstraps, Telegram dispatches, authorized delivery requests and rejections, plus six fixed delivery-start probes. Its success counters are printed with each run. Counts describe these local fixtures, not whole-application or live-service coverage.

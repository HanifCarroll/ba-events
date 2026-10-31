# Generative testing

Text normalization stays stable for Unicode input. Encrypted Telegram handoffs round-trip JSON, bind to their update and queue identities, and reject tampering. HTTP tests cover anonymous rejection by the real GET/POST `/api/events` and POST `/api/chat/bootstrap` handlers. A synthetic API key and `locals.user = null` model the anonymous session; this does not test session establishment, authenticated database operations, or provider execution.

## Run locally

Use Node.js 24, Bun 1.3.14, Python 3.10+ and [uv](https://docs.astral.sh/uv/getting-started/installation/).
The committed JavaScript lockfile pins `fast-check@4.10.2` and `@jazzer.js/core@4.0.0`. The API runner uses `uvx --from schemathesis==4.32.7`; uv installs it in an isolated cached environment. To also install the CLI on your PATH, run `uv tool install schemathesis==4.32.7`.

```sh
bun install --frozen-lockfile
bun run test:generative   # all three tools
bun run test:property     # 3 properties, 500 examples each
bun run test:fuzz         # 10,000 coverage-guided Jazzer.js runs
bun run test:api          # local HTTP contract generation, up to 100 examples per operation
```

Property tests also run in the normal unit suite. The dedicated GitHub Actions workflow runs all three tools on pushes and pull requests and retains reports, generated corpus, and failure inputs for seven days. These checks do not deploy the application.

## Scope and isolation

[Jazzer.js](https://github.com/CodeIntelligenceTesting/jazzer.js) is the JavaScript implementation of Jazzer; the JVM tool does not execute this codebase. The runner compiles the TypeScript target and its production dependencies to ESM with Bun, then runs Node.js so Jazzer can instrument them. The input limit is 4 KiB and the per-input timeout is five seconds. This is a bounded smoke campaign, not exhaustive assurance.

The API contract in `tests/fuzz/openapi.json` documents only the selected test surface. A small loopback HTTP adapter invokes the production handlers. SvelteKit/Cloudflare middleware and deployment configuration are outside this harness. Schemathesis generates positive and negative inputs and checks server errors, documented status codes, content types, response headers, and response schemas. Validation-policy checks are deliberately separate: an anonymous request remains unauthorized regardless of body validity, and some existing handlers tolerate extra fields.

The runner clears inherited provider/database credentials, disables Bun's automatic environment-file loading, binds an ephemeral port on `127.0.0.1`, and closes its server and temporary storage after the run. It accepts no external API URL. Generated files stay under ignored `tmp/fuzz/`; reviewed seed inputs live in `tests/fuzz/corpus/`.

## Reproduce and extend

The default seed is `20261031`. Property failures print their minimized counterexample and replay path. Change the property seed with `FC_SEED=123 bun run test:property`; copy a reported path into that property's `fc.assert` options to replay the exact shrink result.

For a longer Jazzer campaign:

```sh
node scripts/run-fuzz.mjs jazzer -runs=100000 -seed=123
```

Replay a saved failure after building the target with `test:fuzz`:

```sh
node node_modules/@jazzer.js/core/dist/cli.js tmp/fuzz/target.mjs tmp/fuzz/artifacts/crash-HASH --sync -- -runs=1
```

Promote a minimized failure into a named regression test and a reviewed corpus seed. Schemathesis retains its failure database at `tmp/fuzz/hypothesis` and JUnit report at `tmp/fuzz/schemathesis.xml`. To extend API coverage, update the contract and local fixture together; keep provider calls and real account data out of the harness.

## Initial local verification

On 2026-10-31, all three properties passed 500 examples each, Jazzer completed 10,000 executions, and Schemathesis passed 300 generated HTTP cases. Seed: `20261031`. These counts describe the selected surfaces above, not whole-application coverage.

Schemathesis reports an authentication warning because these three operations intentionally require HTTP 401 for an anonymous session. The response schemas require that exact result; authenticated execution needs separate local database fixtures before it can be added.

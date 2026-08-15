# Card T1 — trigger, evals, scripts, deploy, service worker

## Objective

Port everything outside `src/` runtime scope that makes the app operable: Trigger.dev jobs,
eval harness, scripts, Netlify config, and the PWA service worker. Per
`migration/CONTRACTS.md`.

## Scope (legacy base = /Users/hanifcarroll/projects/ba-events)

| Legacy | New |
|---|---|
| src/trigger/client.ts, src/trigger/jobs/*.ts (9 files), src/trigger/utils/db-client.ts | same paths — import rewrites only (`@/` → `#…` with extensions) |
| trigger.config.ts | trigger.config.ts (verbatim except any `@/` paths) |
| evals/** (all) | evals/** — import rewrites; `evals/lib/checks.ts` `META_NARRATION_PATTERN` must now import from/stay in sync with `#features/chat/api/stream-helpers.ts` (preserve the legacy sync comment) |
| scripts/** (all) | scripts/** — import rewrites |
| test-setup.ts | test-setup.ts — trim to what vitest needs; if ported tests only need `fake-indexeddb/auto` inline (they have it), you may omit wiring `setupFiles`; document the decision |
| netlify.toml | netlify.toml — update for adapter-netlify: `publish = "build"`, keep `command = "bun install && bun run build"`, keep NODE_VERSION 24, SW header path `/sw.js` → `/service-worker.js` |
| PWA (vite pwaWorkbox plugin) | src/service-worker.ts — see below |

Also: package.json scripts — restore `eval:concierge`, `eval:topic-guard`, `eval:search`,
`eval:search:semantic`, `eval:relevance`, `snapshot:search-corpus`, `eval:titles`,
`trigger:dev`, `trigger:deploy` (same commands as legacy, bun).

## Service worker (SvelteKit 3 native)

Legacy generated `sw.js` via workbox-build at build time: precache of client build assets
(js/css/svg/png/ico/json/woff2), `skipWaiting` + `clientsClaim`, no navigate fallback,
StaleWhileRevalidate for `fonts.googleapis.com`/`fonts.gstatic.com` (1y, 20 entries).

New: `src/service-worker.ts` using `$app/manifest` (`immutable`, `assets`, `prerendered`)
and `self` from `$app/service-worker` (SvelteKit 3 pattern — check
`bunx @sveltejs/mcp get-documentation "kit/service-workers"` and `"kit/$app-manifest"`).
Replicate: precache manifest assets, skipWaiting/clientsClaim, fonts SWR runtime cache,
no navigation caching (SSR locale variance — legacy comment explains why; keep it).
Add `src/tsconfig.json` guidance from the docs ONLY if the docs require a service-worker
tsconfig sibling (SvelteKit 3: `tsconfig.json` alongside the SW extending
`$app/tsconfig/service-worker`).

## Acceptance

1. `bunx tsc --noEmit` — zero errors in `src/trigger/**`, `evals/**`, `scripts/**`
   (add `evals`/`scripts` to tsconfig include if needed — extend the root tsconfig's
   `include` explicitly, keep `$app/tsconfig` extend).
2. `bun run check` green.
3. `grep -rn "@tanstack\|from 'react'\|@/shared\|@/features" src/trigger evals scripts` → empty.
4. `bun run build` succeeds including the service worker.
5. `bunx trigger.dev@latest whoami`-style validation is NOT required (no network calls to
   Trigger); a dry `bun run trigger:dev` startup is FORBIDDEN (long-running).

## Boundaries

No deps, no git, no dev server. No changes to feature modules; import rewrites only in
your scope. If an eval imports a legacy path that no longer exists (e.g. the React route
file), retarget to the contract-correct new path and note it.

## Evidence

`migration/evidence/T1-trigger-evals-deploy.md` per CONTRACTS.md §10.

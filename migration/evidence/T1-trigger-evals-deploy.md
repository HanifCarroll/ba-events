# T1 — trigger, evals, scripts, deploy, service worker — evidence

## Scope done

### Trigger (`src/trigger/**`) — copied + import rewrites only
- `src/trigger/client.ts` — verbatim (no legacy-path imports).
- `src/trigger/utils/db-client.ts` — `@/shared/lib/db/node-realtime` → `#shared/lib/db/node-realtime.ts`.
- `src/trigger/jobs/daily-scrape.ts` — `@/features/import/core/*` + relative `./*` type imports → `#…/…​.ts` / `./…​.ts`.
- `src/trigger/jobs/enrich-events.ts` — `@/features/import/core/event-enrichment` → `#…​.ts`.
- `src/trigger/jobs/enrichment-catchup.ts` — same mapping.
- `src/trigger/jobs/scrape-ba-tourism.ts` — `@/features/import/core/ba-tourism` → `#…​.ts`.
- `src/trigger/jobs/scrape-eventbrite.ts` — `@/features/import/core/eventbrite` → `#…​.ts`.
- `src/trigger/jobs/scrape-luma.ts` — `@/features/import/core/luma` → `#…​.ts`.
- `src/trigger/jobs/scrape-meetup.ts` — `@/features/import/core/meetup` → `#…​.ts`.
- `src/trigger/jobs/scrape-passline.ts` — `@/features/import/core/passline` → `#…​.ts`.
- `src/trigger/jobs/scrape-venti.ts` — `@/features/import/core/venti` → `#…​.ts`.

### Trigger config
- `trigger.config.ts` — verbatim (contains no `@/` paths). Excluded from the app
  tsconfig — see Deviations.

### Evals (`evals/**`) — copied + import rewrites
- `evals/concierge/cases.ts`, `run.ts` — relative → `../lib/run-agent.ts` / `./cases.ts` etc.
- `evals/lib/report.ts` — no imports.
- `evals/lib/checks.ts` — `META_NARRATION_PATTERN` now imported from
  `#features/chat/api/stream-helpers.ts` (single source), sync comment preserved.
- `evals/lib/run-agent.ts` — `@/features/chat/api/prompts` → `…​/prompts/index.ts`,
  `tools-ai-sdk` → `…​.ts`, `user-tools` → `…​/user-tools.server.ts`,
  `@/shared/lib/ai/providers` → `…​.ts`, `@/shared/lib/types` → `…​.ts`.
- `evals/search/corpus/fixture.ts` — `@/shared/lib/constants` → `…​.ts`, `./types` → `…​.ts`.
- `evals/search/corpus/types.ts` — no imports.
- `evals/search/golden.ts`, `golden-2026-08-08.ts` — no imports.
- `evals/search/inspect-events.ts` — `@/shared/lib/db/client` → `…​/client.server.ts`.
- `evals/search/run.ts`, `run-semantic.ts` — `@/shared/lib/db/client` → `…​/client.server.ts`, `../lib/checks` → `…​.ts`, `./golden` → `…​.ts`.
- `evals/search/relevance/queries.ts` — `@/shared/lib/constants`, `@/features/chat/api/tools/search-events` → `#…​.ts`.
- `evals/search/relevance/run.ts` — `@/features/chat/api/tools/search-intent`, `@/shared/lib/utils/normalize-text`, `@/shared/lib/constants`, `../corpus/types`, `./queries` → `#…​.ts`.
- `evals/titles/cases.ts`, `run.ts` — `@/features/chat/api/generate-title` → `…​/generate-title.server.ts`, `../lib/*` → `…​.ts`.
- `evals/topic-guard/cases.ts`, `run.ts` — `@/features/chat/api/topic-guard` → `…​.ts`, `../lib/*` → `…​.ts`.

### Scripts (`scripts/**`) — copied + import rewrites
- All `@/…` and `../src/…` imports → `#…` + explicit `.ts` (see Deviations for dotenv).
- `scripts/test-ba-tourism.ts` — barrel `../src/features/import/scrapers/ba-tourism`
  → `#features/import/scrapers/ba-tourism/browser-scraper.ts`.
- `scripts/test-eventbrite-scraper.ts` — barrel `eventbrite` split into
  `api.ts` / `transformer.ts` / `enrichment.ts` (dynamic import).
- `scripts/snapshot-search-corpus.ts` — `../evals/…` → `…​.ts`,
  dynamic `import('@/shared/lib/db/client')` → `import('#shared/lib/db/client.server.ts')`.
- `scripts/query-va-venues.mjs` — kept verbatim (dead Drizzle-era JS), excluded from type-check.

### Deploy / PWA
- `netlify.toml` — `publish = "build"`, `command = "bun install && bun run build"`,
  NODE_VERSION 24, SW header `/sw.js` → `/service-worker.js`.
- `src/service-worker.ts` — SvelteKit 3 native SW: precache `immutable` + `assets` +
  `prerendered` from `$app/manifest`, `self` from `$app/service-worker`,
  `skipWaiting` + `clients.claim()`, Google Fonts StaleWhileRevalidate
  (1y / 20 entries), no navigation caching (legacy comment preserved).
- `src/tsconfig.json` — extends `$app/tsconfig/service-worker`, includes `service-worker.ts`.
- `tsconfig.json` — explicit `include` (src / evals / scripts / vite.config) +
  `exclude` (`src/service-worker.ts`, `scripts/**/*.mjs`).

### package.json
- Restored `eval:concierge`, `eval:topic-guard`, `eval:search`, `eval:search:semantic`,
  `eval:relevance`, `snapshot:search-corpus`, `eval:titles`, `trigger:dev`,
  `trigger:deploy`. `npx trigger.dev@latest` → `bunx trigger.dev@latest` (Bun only).

### test-setup.ts
- Omitted (deleted) — legacy Bun test preload is redundant under Vitest; the two
  Dexie/IndexedDB tests already `import 'fake-indexeddb/auto'` inline (CONTRACTS §8).
  No `setupFiles` wired.

## Commands + outputs

### Acceptance 1 — `bunx tsc --noEmit`
```
EXIT=0
```
(no errors)

### Acceptance 2 — `bun run check`
```
$ svelte-kit sync && svelte-check --tsconfig ./tsconfig.json
1786816185108 COMPLETED 6322 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
EXIT=0
```

### Acceptance 3 — `grep -rn "@tanstack\|from 'react'\|@/shared\|@/features" src/trigger evals scripts`
```
GREP_EXIT=1 (1 = no matches = pass)
```

### Service worker type-check — `bunx tsc -p src/tsconfig.json --noEmit`
```
EXIT=0
```

### Acceptance 4 — `bun run build`
```
✓ built in 3.07s
Building service worker
vite v8.2.1 building serviceWorker environment for production...
✓ 9 modules transformed.
.svelte-kit/output/client/service-worker.js                   3.74 kB │ gzip: 1.39 kB
✓ built in 15ms

> Using @sveltejs/adapter-netlify
Publishing to "build"
Copying assets...
Writing Netlify config...
Generating serverless functions...
✔ done
EXIT=0
```

## Deviations

1. **`dotenv` removed from 24 scripts.** `dotenv` is not a declared dependency in
   this repo (legacy had it only as a hoisted transitive). Bun auto-loads `.env`
   when running `bun scripts/*.ts`, so each `import { config } from 'dotenv'` +
   `config({ path: '.env' })` was removed and replaced with a comment. Behavior is
   preserved (env vars still load via Bun).

2. **`trigger.config.ts` excluded from the app tsconfig.** It imports
   `@trigger.dev/build/extensions/{playwright,core}`, and `@trigger.dev/build` is not
   a declared dependency here (legacy had it only as a hoisted transitive; it is
   provided by the `trigger.dev` CLI). The file is kept **verbatim** and excluded
   from `tsc`/`svelte-check` because it is governed by the Trigger.dev CLI, not the
   SvelteKit app program. `trigger:dev`/`trigger:deploy` run `bunx trigger.dev@latest`.

3. **`test-setup.ts` omitted.** Redundant under Vitest (see Scope done). Decision
   per the card: inline `fake-indexeddb/auto` imports cover it; no `setupFiles`.

4. **`scripts/query-va-venues.mjs` excluded from type-check.** Dead Drizzle-era JS
   (imports `../src/db/*` and `drizzle-orm`, neither of which exists in this
   repo; `drizzle-orm` is not a dependency). Kept verbatim for reference; the live
   Supabase rewrite is `scripts/query-va-venues.ts`. Excluded via `scripts/**/*.mjs`.

5. **Root `tsconfig.json` gained explicit `include`/`exclude`.** After `bun run
   build`, `tsc`/`svelte-check` were type-checking the compiled client output under
   `build/` (thousands of `checkJs` implicit-any errors). Explicit `include`
   (`.svelte-kit/types/**/$types.d.ts`, `src/**`, `evals/**`, `scripts/**`,
   `vite.config.ts`) + `exclude` (`src/service-worker.ts`, `scripts/**/*.mjs`)
   scopes the program to source only. `trigger.config.ts` is outside `include`.

6. **`trigger:dev` / `trigger:deploy` use `bunx` instead of `npx`** (AGENTS.md: Bun
   only; `bunx` for one-shot CLIs).

7. **Service-worker cache name does not use `$app/env` `version`.** Inside the
   service-worker build, `$app/env` `version` resolves to `payload.version`
   (undefined) because the SW build applies the `browser` esm-env condition but has
   no client payload. Instead the cache name is `ba-events-<hash(precache paths)>`,
   which changes per deploy (immutable asset filenames are content-hashed) and
   replicates workbox's per-deploy cache invalidation.

8. **Scraper barrel imports retargeted.** Legacy `@/features/import/scrapers/
   {ba-tourism,eventbrite}` (barrel `index.ts`) had no replacement under the
   no-barrel rule; retargeted to the concrete modules (`browser-scraper.ts`,
   `api.ts`, `transformer.ts`, `enrichment.ts`).

9. **`evals/lib/checks.ts` `META_NARRATION_PATTERN`** now imported from
   `#features/chat/api/stream-helpers.ts` instead of defined locally (card
   requirement); the legacy sync comment is preserved and points at the new
   single source.

## Cross-import debts

None. Every import in `src/trigger/**`, `evals/**`, `scripts/**` resolves; no
modules owned by other cards are missing.

## TODOs

- `@migration TODO` — `trigger.config.ts` references `@trigger.dev/build`
  (playwright + syncEnvVars extensions). Before deploying to Trigger.dev, ensure
  `@trigger.dev/build` is available to the CLI (it is provided by
  `bunx trigger.dev@latest`) or add it as an explicit devDependency. The config
  itself is unchanged.
- `@migration TODO` — `scripts/query-va-venues.mjs` is dead Drizzle code; delete
  once the Supabase `query-va-venues.ts` path is confirmed.

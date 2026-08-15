# Card 04 — import-core — evidence

## Scope done

All files ported 1:1 from `/Users/hanifcarroll/projects/ba-events/src/features/import/{core,adapters,api,config}` with contract §2 import rewrites. No `.svelte` / `.svelte.ts` files in this card, so the §9 autofixer gate is N/A.

### `core/`
| File | Note |
|---|---|
| `ba-tourism.ts` | orchestrator; scrapers/ai/shared imports rewritten to `#…/*.ts` |
| `eventbrite.ts` | orchestrator; same rewrite |
| `luma.ts` | orchestrator; same rewrite |
| `meetup.ts` | orchestrator; legacy `../scrapers/meetup` barrel expanded to real files (see Deviations) |
| `passline.ts` | orchestrator; `isBrowserbaseAvailable` imported from the direct `browserbase.ts` file |
| `venti.ts` | orchestrator; same rewrite |
| `event-enrichment.ts` | enrichment core; adapter barrel split into `registry.ts` + `enrichment-types.ts` |
| `event-enrichment.test.ts` | ported with identical assertions (deferred-integration — see Cross-import debts) |
| `geo-validation.ts` | verbatim + import rewrite |
| `nominatim.ts` | verbatim + import rewrite |
| `venue-review.ts` | verbatim (no framework imports) |
| `venue-settlement.ts` | verbatim + import rewrite |

### `adapters/`
| File | Note |
|---|---|
| `enrichment-types.ts` | verbatim + `./types` → `./types.ts` |
| `types.ts` | verbatim + `../api/duplicate-detection` → `.ts` |
| `enrichment/ba-tourism-enrichment.ts` | verbatim + import rewrite |
| `enrichment/eventbrite-enrichment.ts` | verbatim + import rewrite |
| `enrichment/luma-enrichment.ts` | verbatim + import rewrite |
| `enrichment/meetup-enrichment.ts` | verbatim + import rewrite |
| `enrichment/passline-enrichment.ts` | verbatim + import rewrite |
| `enrichment/registry.ts` | **new named module** — carries the registry logic from the legacy `enrichment/index.ts` barrel (see Barrel inventory) |

### `api/`
| File | Note |
|---|---|
| `duplicate-detection.ts` | verbatim; `@/shared/lib/db/client` → `#shared/lib/db/client.server.ts` |
| `duplicate-detection.test.ts` | identical assertions; mock path → `#shared/lib/ai/embeddings.ts` |

### `config/`
| File | Note |
|---|---|
| `enrichment-config.ts` | verbatim (no imports) |

## Barrel inventory

- **`adapters/index.ts`** — pure re-export barrel, NOT ported. It re-exported:
  `export * from './types'`, `export * from './enrichment-types'`,
  `export * from './enrichment'`. Those names now live in `types.ts`,
  `enrichment-types.ts`, and `enrichment/registry.ts` respectively.
- **`adapters/enrichment/index.ts`** — mixed barrel (logic + re-exports). Logic ported to
  `enrichment/registry.ts`, which keeps the exported function names:
  `getEnrichmentAdapter`, `requiresClientSideEnrichment`,
  `supportsDescriptionEnrichment`, `supportsVenueEnrichment`, `getKnownLanguage`,
  `getEnrichableSources`, `getClientSideEnrichmentSources`,
  `getServerSideEnrichmentSources`. The re-export names dropped (barrel re-exports,
  per contract §1) are the five adapter constants (`passlineEnrichmentAdapter`,
  `meetupEnrichmentAdapter`, `lumaEnrichmentAdapter`, `baTourismEnrichmentAdapter`,
  `eventbriteEnrichmentAdapter`) and `export * from '../enrichment-types'`.
  The adapters remain importable from their own files
  (`enrichment/passline-enrichment.ts`, …); the only consumer of the barrel was
  `event-enrichment.ts`, which now imports `getEnrichmentAdapter` from `registry.ts`
  and `hasServerEnrichment` from `enrichment-types.ts`.

## Commands + outputs

### 1. `bunx tsc --noEmit 2>&1` (verbatim, exit 2)

```
src/features/chat/api/user-tools.server.ts(15,32): error TS2307: Cannot find module '#features/auth/api/session.server.ts' or its corresponding type declarations.
src/features/chat/lib/saved.ts(2,42): error TS2307: Cannot find module '#features/auth/api/client.ts' or its corresponding type declarations.
```

Zero errors in `src/features/import/{core,adapters,api,config}`. The two errors are
`#features/auth/api/...` modules owned by card S1 (auth shell, in-flight) — tolerated
per contract §10.

### 2. `bunx vitest run src/features/import/api src/features/import/core` (verbatim tail)

```
 RUN  v4.1.10 /Users/hanifcarroll/projects/ba-events-sveltekit

 ❯ |server| src/features/import/core/event-enrichment.test.ts (0 test)

⎯⎯⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  |server| src/features/import/core/event-enrichment.test.ts [ src/features/import/core/event-enrichment.test.ts ]
Error: Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables
 ❯ getSupabase src/shared/lib/db/client.server.ts:32:13
 ❯ src/features/import/scrapers/venue-matcher.ts:10:18
 ❯ src/features/import/core/venue-settlement.ts:11:1

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed | 1 passed (2)
      Tests  13 passed (13)
```

`duplicate-detection.test.ts` is green in isolation:

```
bunx vitest run src/features/import/api/duplicate-detection.test.ts
 → Test Files  1 passed (1)   /   Tests  13 passed (13)
```

### 3. `grep -rn "@tanstack\|from 'react'\|import.meta.env\|\$app/\|\$env/" src/features/import/{core,adapters,api,config}`

Empty (exit 1). ✅

## Deviations

1. **`passline.ts`** imports `isBrowserbaseAvailable` from
   `#shared/lib/browser/browserbase.ts` (the defining file) rather than the
   `#shared/lib/browser/index.ts` barrel — direct-import rule (contract §1). Behavior 1:1.
2. **`adapters/enrichment/index.ts`** → **`registry.ts`**: the legacy file mixed registry
   logic with `export *` re-exports. Logic went to `registry.ts`; barrel re-exports dropped
   (recorded above). No behavioral change.
3. **`meetup.ts`** legacy barrel import `../scrapers/meetup` expanded to the real files:
   `browser-scraper.ts` (`scrapeMeetupEvents`, `filterInPersonEvents`, `filterByDateRange`),
   `venue-enrichment.ts` (`enrichMeetupEventsWithVenues`), `types.ts` (`MeetupEvent`).
   Names and behavior unchanged.
4. **`event-enrichment.test.ts` runs but is `deferred-integration`** (see below). The test
   body is a 1:1 port; it fails only at module-load time, before any test executes.

## Cross-import debts

- **`event-enrichment.test.ts` → `venue-matcher.ts` (card 03)**. `venue-matcher.ts` runs
  `const supabase = getSupabase()` at module top level (faithful legacy behavior), and
  `event-enrichment.ts` → `venue-settlement.ts` (this card) imports it. This repo's vitest
  config does **not** load `.env` (verified: `process.env.SUPABASE_URL` is `undefined`
  under `bunx vitest run`), whereas the legacy `vitest run` did load `.env`, so
  `getSupabase()` throws here. This is an infra/config gap (a vitest env-loading setup in
  `vite.config.ts` or a setup file — out of card 04 scope), not a defect in the ported test.
  Marked **`deferred-integration`** per contract §8.
- **`event-enrichment.ts`** imports `buildDescriptionPresentationFields` from
  `#features/events/lib/description-presentation.server.ts` (card 06). Present at check time;
  compiled clean.
- **tsc**: the two remaining errors name `#features/auth/api/session.server.ts` and
  `#features/auth/api/client.ts` (card S1, in-flight) — outside this card's files.

## TODOs

None. No `@migration TODO:` markers were needed.

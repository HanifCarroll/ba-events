# Card 04 — import-core

## Objective

Port the import pipeline core (per-source orchestrators, enrichment adapters, duplicate
detection, config) to the SvelteKit repo per `migration/CONTRACTS.md`.

## Scope (legacy base = /Users/hanifcarroll/projects/ba-events)

`src/features/import/{core,adapters,api,config}/**` → same paths:

- `core/`: ba-tourism, eventbrite, luma, meetup, passline, venti, event-enrichment
  (+ event-enrichment.test.ts), geo-validation, nominatim, venue-review, venue-settlement
- `adapters/`: enrichment-types, types, enrichment/{ba-tourism,eventbrite,luma,meetup,passline}-enrichment
- `api/`: duplicate-detection.ts (+ duplicate-detection.test.ts)
- `config/`: enrichment-config.ts

Index files (`adapters/index.ts`, `adapters/enrichment/index.ts`): if pure re-export
barrels, do NOT port them; record their exported names in evidence. If they contain logic,
port the logic into a named module.

## Steps

1. Read CONTRACTS.md fully.
2. Port each file 1:1 with contract §2 import rewrites. Cross-imports into
   `#features/import/scrapers/**` (card 03, same wave): use the real module paths, NOT the
   legacy barrel — card 03's evidence (or its scope table) tells you the real files; if a
   barrel has not been expanded yet, read the legacy barrel to find the real source file.
3. `process.env.*` stays (contract §3). No `$app/*`, no `$env/*` — Trigger-compatible.
4. Tests: port `event-enrichment.test.ts` and `duplicate-detection.test.ts` with identical
   assertions.

## Acceptance

1. `bunx tsc --noEmit 2>&1` — zero errors in your files except tolerated missing-module
   errors naming in-flight paths.
2. `bunx vitest run src/features/import/api src/features/import/core` — green (or
   deferred-integration notes).
3. `grep -rn "@tanstack\|from 'react'\|import.meta.env\|\$app/\|\$env/" src/features/import/{core,adapters,api,config}` → empty.

## Boundaries

No deps, no git, no dev server, no files outside scope. `import/scrapers/**` is card 03.

## Evidence

`migration/evidence/04-import-core.md` per CONTRACTS.md §10, including barrel inventory.

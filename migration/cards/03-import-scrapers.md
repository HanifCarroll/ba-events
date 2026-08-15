# Card 03 — import-scrapers

## Objective

Port all six source scrapers (+ shared scraper utilities) to the SvelteKit repo per
`migration/CONTRACTS.md`. This is framework-agnostic code that runs under Trigger.dev —
the port is import-path rewriting plus keeping behavior identical.

## Scope (legacy base = /Users/hanifcarroll/projects/ba-events)

`src/features/import/scrapers/**` → `src/features/import/scrapers/**`:

- `ai-categorizer.ts`
- `ba-tourism/`: browser-scraper, client, date-parser, enrichment, scraper, transformer, types
- `eventbrite/`: api, detail, enrichment, transformer (+ transformer.test.ts)
- `luma/`: api, description-enrichment, transformer, types, venue-enrichment
- `meetup/`: browser-scraper, date-parser, description-enrichment, transformer, types, venue-enrichment
- `passline/`: address-enrichment, api, browser-scraper, client-enrichment, client, description-enrichment, transformer (+ transformer.test.ts)
- `shared/`: blocklist-filter, normalization
- `venti/`: api, transformer, types
- `venue-matcher.ts`

Index files: each source dir has an `index.ts` and there is `scrapers/index.ts` +
`shared/index.ts`. If one is a pure re-export barrel, DO NOT port it (contract §1: no
barrels) — record the barrel's exported names in evidence so import sites can target the
real files. If one contains real logic, port the logic into a named module.

## Steps

1. Read CONTRACTS.md fully.
2. Port each file 1:1. Imports of `@/shared/...` become `#shared/...ts` — these modules
   exist already (wave 1): `db/client.server.ts`, `ai/providers.ts`, `browser/*`,
   `logger.ts`, `schemas.ts`, `types.ts`, `html-parsing.ts`, utils. If one is still missing
   when you check, keep the correct path and note it (contract §10).
3. `process.env.*` stays as-is everywhere here (contract §3 — Trigger runtime).
4. Tests: port the two `transformer.test.ts` files with identical assertions.
5. These modules must remain importable OUTSIDE SvelteKit (Trigger jobs). No `$app/*`,
   no `$env/*`, no `.svelte` files.

## Acceptance

1. `bunx tsc --noEmit 2>&1` — zero errors in your files except tolerated missing-module
   errors naming other in-flight paths.
2. `bunx vitest run src/features/import/scrapers` — green.
3. `grep -rn "@tanstack\|from 'react'\|import.meta.env\|\$app/\|\$env/" src/features/import/scrapers` → empty.

## Boundaries

No deps, no git, no dev server, no files outside the scope above. `import/core`,
`import/adapters`, `import/api`, `import/config` belong to card 04 — do not touch.

## Evidence

`migration/evidence/03-import-scrapers.md` per CONTRACTS.md §10. Include the barrel
inventory (which index.ts files were skipped and what they re-exported).

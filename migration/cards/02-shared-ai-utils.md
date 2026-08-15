# Card 02 — shared-ai-utils

## Objective

Port the legacy AI providers, browser automation helpers, and pure utility modules to the
SvelteKit repo, framework-free, per `migration/CONTRACTS.md`.

## Scope (legacy → new; legacy base = /Users/hanifcarroll/projects/ba-events)

| Legacy file | New file |
|---|---|
| src/shared/lib/ai/constants.ts | same path |
| src/shared/lib/ai/providers.ts | same path |
| src/shared/lib/ai/embeddings.ts (+ .test.ts) | same paths |
| src/shared/lib/ai/enrichment.ts (+ .test.ts) | same paths |
| src/shared/lib/ai/extract-facets.ts (+ .test.ts) | same paths |
| src/shared/lib/browser/browserbase.ts | same path |
| src/shared/lib/browser/cloudflare.ts | same path |
| src/shared/lib/browser/constants.ts | same path |
| src/shared/lib/browser/index.ts | same path |
| src/shared/lib/utils/debounce.ts | same path |
| src/shared/lib/utils/formatting.ts | same path |
| src/shared/lib/utils/index.ts | same path |
| src/shared/lib/utils/maps.ts (+ .test.ts) | same paths |
| src/shared/lib/utils/neighborhood.ts | same path |
| src/shared/lib/utils/normalize-text.ts | same path |
| src/shared/lib/utils/url.ts | same path |
| src/shared/lib/schemas.ts | same path |
| src/shared/lib/types.ts | same path |
| src/shared/lib/constants.ts | same path |
| src/shared/lib/search-facets.ts | same path |
| src/shared/lib/html-parsing.ts | same path |
| src/shared/lib/search/rrf.ts (+ .test.ts) | same paths |

NOT ported (deliberate): `src/shared/lib/query.ts` (TanStack Query — contract §2 deletes it).
NOT in scope: `src/shared/hooks/**`, `src/shared/ui/**`, `src/shared/providers/**`
(UI wave cards).

## Steps

1. Read CONTRACTS.md fully.
2. Read every legacy file in scope. Port 1:1 with import rewrites per contract §2.
3. `ai/constants.ts` and `ai/providers.ts` keep `process.env.*` exactly (contract §3 —
   these modules are also imported by Trigger jobs).
4. Tests port with identical assertions; only import paths change.
5. If a scoped file imports a card-01 module that does not exist yet (e.g.
   `#shared/lib/logger.ts`), keep the correct import; tolerate the transient error.

## Acceptance

1. `bunx tsc --noEmit 2>&1` — zero errors in your new files except tolerated
   cannot-find-module errors pointing at card-01 paths.
2. `bunx vitest run src/shared/lib/ai src/shared/lib/utils src/shared/lib/search` — green
   (or deferred-integration note). Note: embeddings/enrichment tests may hit network or
   need env — if a legacy test was self-contained it must pass; if it needs live APIs,
   check the legacy file for mocking and mirror it; otherwise mark deferred with reason.
3. `grep -rn "@tanstack\|from 'react'\|import.meta.env" src/shared/lib/{ai,browser,utils,search} src/shared/lib/{schemas,types,constants,search-facets,html-parsing}.ts`
   returns nothing.

## Boundaries

Do NOT: install deps, run git, start dev servers, touch files outside the table above.

## Evidence

Write `migration/evidence/02-shared-ai-utils.md` per CONTRACTS.md §10.

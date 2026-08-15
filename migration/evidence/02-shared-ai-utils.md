# Card 02 — shared-ai-utils — evidence

## Scope done

Ported 27 files (25 source + 4 `.test.ts`, minus the 2 tests already counted) from
`/Users/hanifcarroll/projects/ba-events/src/shared/lib` to `src/shared/lib` with only
import-path rewrites (contract §2/§4). Fidelity was verified file-by-file with `diff`
against the legacy sources — every difference is an import rewrite or the single
deliberate `url.ts` change noted under Deviations.

| New file | Note |
|---|---|
| `src/shared/lib/ai/constants.ts` | verbatim (no imports) |
| `src/shared/lib/ai/providers.ts` | `./constants` → `./constants.ts`; `process.env.*` kept (§3) |
| `src/shared/lib/ai/embeddings.ts` | `../db/client` → `#shared/lib/db/client.server.ts` (§4); relative imports get `.ts`; `@/shared/lib/search-facets` → `#shared/lib/search-facets.ts` |
| `src/shared/lib/ai/embeddings.test.ts` | `./embeddings` → `./embeddings.ts`; assertions unchanged |
| `src/shared/lib/ai/enrichment.ts` | `./providers` → `./providers.ts`; `../errors` → `../errors.ts` |
| `src/shared/lib/ai/enrichment.test.ts` | `./enrichment` → `./enrichment.ts`; assertions unchanged |
| `src/shared/lib/ai/extract-facets.ts` | `@/shared/lib/logger` → `#shared/lib/logger.ts`; `./providers` → `./providers.ts`; search-facets alias |
| `src/shared/lib/ai/extract-facets.test.ts` | relative/alias import rewrites only; assertions unchanged |
| `src/shared/lib/browser/browserbase.ts` | `./constants` → `./constants.ts`; `process.env.*` kept |
| `src/shared/lib/browser/cloudflare.ts` | verbatim (no imports) |
| `src/shared/lib/browser/constants.ts` | verbatim (no imports) |
| `src/shared/lib/browser/index.ts` | re-export paths get `.ts` |
| `src/shared/lib/utils/debounce.ts` | verbatim (no imports) |
| `src/shared/lib/utils/formatting.ts` | `@/paraglide/runtime` → `#paraglide/runtime.js`; `@/shared/lib/constants` → `#shared/lib/constants.ts` |
| `src/shared/lib/utils/index.ts` | `./debounce` → `./debounce.ts` (keeps legacy double-quote style) |
| `src/shared/lib/utils/maps.ts` | verbatim (no imports) |
| `src/shared/lib/utils/maps.test.ts` | `./maps` → `./maps.ts`; assertions unchanged |
| `src/shared/lib/utils/neighborhood.ts` | `@/shared/lib/types` → `#shared/lib/types.ts` (both type + value imports) |
| `src/shared/lib/utils/normalize-text.ts` | verbatim (no imports) |
| `src/shared/lib/utils/url.ts` | **see Deviations** — `import.meta.env` removed, `typeof window` → `browser` from `$app/env` |
| `src/shared/lib/schemas.ts` | `./types` → `./types.ts` |
| `src/shared/lib/types.ts` | `@/features/chat/api/tools/search-events` → `#features/chat/api/tools/search-events.ts`; search-facets alias |
| `src/shared/lib/constants.ts` | verbatim (no imports) |
| `src/shared/lib/search-facets.ts` | verbatim (only `zod`) |
| `src/shared/lib/html-parsing.ts` | `./errors` → `./errors.ts` |
| `src/shared/lib/search/rrf.ts` | verbatim (no imports) |
| `src/shared/lib/search/rrf.test.ts` | `./rrf` → `./rrf.ts`; assertions unchanged |

## Commands + outputs

### 1. `bunx tsc --noEmit 2>&1`

```
src/shared/lib/types.ts(1,40): error TS2307: Cannot find module '#features/chat/api/tools/search-events.ts' or its corresponding type declarations.
```

(exit code 2). The single error is the tolerated cross-card `cannot-find-module` —
`SearchEventsInput` is owned by card 05 (`chat-api`), listed under Cross-import debts.
Zero errors in any other file written by this card.

### 2. `bunx vitest run src/shared/lib/ai src/shared/lib/utils src/shared/lib/search 2>&1`

```
 RUN  v4.1.10 /Users/hanifcarroll/projects/ba-events-sveltekit

 Test Files  5 passed (5)
      Tests  28 passed (28)
   Start at  12:47:50
   Duration  1.04s (transform 264ms, setup 0ms, import 1.32s, tests 22ms, environment 1ms)
```

(exit code 0). All 28 tests across embeddings / enrichment / extract-facets / maps / rrf
are self-contained (AI calls are `vi.mock('ai', …)`'d) and pass without network/env.

Full suite (`bunx vitest run`, includes card-01's db test) is also green: **6 files, 34 tests passed**.

### 3. `grep -rn "@tanstack\|from 'react'\|import.meta.env" src/shared/lib/{ai,browser,utils,search} src/shared/lib/{schemas,types,constants,search-facets,html-parsing}.ts`

```
(no output — exit 1)
```

## Deviations

1. **`utils/url.ts`** — the legacy `getSiteUrl()` read
   `import.meta.env.VITE_PUBLIC_SITE_URL`. That variable was set **nowhere** in the
   legacy `.env`/`.env.example` (verified by grep), so the branch never fired and the
   function always fell through to `window.location.origin` (browser) or
   `'https://baeventos.com'` (SSR). Contract §3 has no rename for it and the new repo has
   no `PUBLIC_SITE_URL` counterpart. To satisfy the card's grep acceptance check I
   removed the dead `import.meta.env` read and replaced `typeof window !== 'undefined'`
   with `browser` from `$app/env` (contract §6). Runtime behavior is unchanged 1:1.
   The legacy `resolveSiteUrl` scheme regex `/^[a-zA-Z][a-zA-Z\\d+.-]*:/` was kept
   **verbatim**, including its `\\d` (literal-backslash-`d`) quirk — a
   framework-independent legacy bug preserved per contract §1 rather than silently fixed.
2. **`browser/index.ts` and `utils/index.ts`** — these are barrel re-exports, which
   contract §1's "no barrel files" rule would normally forbid. The card's scope table
   lists both at "same path" and many legacy call sites import `@/shared/lib/utils`
   (`cn`) and `@/shared/lib/browser` directly, so they were ported 1:1 as instructed.
3. **`ai/providers.ts`** — kept `openai.textEmbeddingModel(EMBEDDING_MODEL)`, which is
   deprecated (but functional) in `@ai-sdk/openai` v4 in favor of `embeddingModel`.
   Ported 1:1 per the contract; `tsc` reports no error for the deprecation.

## Cross-import debts

- `#features/chat/api/tools/search-events.ts` (imported by `types.ts` for
  `SearchEventsInput`) — owned by card **05 chat-api**; not yet present. This is the
  sole `tsc` error and is tolerated per contract §10.
- Card-01 modules (`#shared/lib/db/client.server.ts`, `#shared/lib/logger.ts`,
  `../errors.ts`) were absent at start but are now present in the tree; no transient
  errors remain from those.

## TODOs

None.

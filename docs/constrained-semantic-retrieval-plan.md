# Constrained Semantic Retrieval — Implementation Plan

**Status:** plan only. Do not implement from this file until Hanif dispatches a phase to a pi / DeepSeek V4 Flash agent.

**Audience:** DeepSeek V4 Flash agents running in **pi** (not omp). Each phase below is one agent task.

**Supersedes:** [Vibe Search: Deterministic Scorer Over Hard-Filtered Candidates](decisions.md) (2026-08-14). Do not edit that entry. Add a new decision when Phase 0 lands.

---

## 0. Why this plan exists

The 2026-08-14 vibe scorer identified a real problem (embeddings cannot enforce free / Saturday / Palermo) and fixed it in the wrong layer. It built a second search engine out of `normalized.includes(phrase)` and token overlap.

Target architecture is **constrained semantic retrieval**:

```
User message
  → structured intent (must / prefer / avoid + semanticQuery)
  → hard SQL filters
  → dense retrieval + lexical retrieval
  → RRF candidate fusion (~50)
  → semantic rerank of top 20–30
  → quality / diversity / personalization
  → return displayLimit (1–5)
```

Do **not** choose embeddings *or* string matching as a complete solution.

| Layer | Job |
| --- | --- |
| String / alias resolution | Canonicalize exact entities: "gratis" → `isFree`, "Palermo Soho" → `Palermo`, "Niceto" → venue id, "este sábado" → BA date range |
| SQL filters | Non-negotiable `must` constraints |
| Dense + lexical retrieval | Recall. Paraphrases *and* artist / venue / title hits |
| Semantic rerank | Subjective fit, composition, negation |
| Deterministic final rules | Quality, diversity, freshness, business policy |

The highest-leverage current bug is not "embeddings are bad." It is that one retrieval method is asked to return the final answer directly.

---

## 1. Current system (verified 2026-08-14)

### 1.1 One tool, three paths

`search_events` in `src/features/chat/api/tools/search-events.ts`.

Runtime schema is **only** `searchEventsInputSchema` (lines 35–57):

- `query?`
- `categories?` (the six: music / arts / food / social / sports / festival)
- `neighborhood?` (single string)
- `isFree?`, `maxPrice?`, `minAge?`
- `timeFilter?`: `now | tonight | tomorrow | weekend | week | future`
- `limit?` (default **1**)

Wired live by `src/features/chat/api/tools-ai-sdk.ts` (`tool({ inputSchema: searchEventsInputSchema })`).

`src/shared/lib/types.ts` `SearchEventsToolInput` (lines 209–235) is **dead**. It claims `vibes[]`, `neighborhoods[]`, `dateFrom`, `dateTo`, `priceMin` that the Zod schema does not accept. Replace it with the Zod-inferred type. No compatibility shim.

### 1.2 Routing (`searchEventsTool.execute`)

```
limit = input.limit ?? 1
vibeIntent = query ? detectVibeIntent(query) : null

timeFilter === 'now'
  → getEventsHappeningNow() + in-memory filters
  → vibeIntent ? rankVibeMatches(...) : slice(0, limit)

else
  → countEventsWithFilters(filters)          // coverage only
  → query && vibeIntent
        → searchEventsWithFilters(filters, 1000) + rankVibeMatches(..., limit)
  → query && !vibeIntent
        → hybridEventSearch(query, filters, limit)   // match_count = display limit
  → no query
        → searchEventsWithFilters(filters, limit)    // soonest N by starts_at
```

`detectVibeIntent` (`vibe-search.ts:342`) fires on any chill / energetic / techno / date / free phrase **or** any neighborhood / weekday / today / tomorrow / weekend token. Then embeddings are skipped.

False-positive class (substring, not token):

- `"recital de rock"` contains `cita` → date intent
- `"freestyle rap"` contains `free` → free intent
- `"dark comedy"` hits `dark` in `TECHNO_SIGNALS`
- `"warehouse exhibition"` hits `/house/` in `TECHNO_TEXT_RE`
- `"anything except techno"` still searches *for* techno

Weekday and free are ranking boosts (`+12` / `+15`), not filters, except neighborhood which `rankVibeMatches` hard-excludes.

### 1.3 `hybridEventSearch` is not hybrid

`src/shared/lib/db/client.ts:316` embeds the raw query and calls RPC `match_events_with_venues_filtered` (current definition: `supabase/migrations/20260811130000_add_min_age_to_search.sql`).

SQL orders only by `e.embedding <=> query_embedding`. Threshold `0.2`. No FTS, no trigram, no RRF.

RPC filter surface: `starts_after/before`, **one** neighborhood, `is_free`, `max_price`, `categories`, `min_age`. No venue id, no neighborhood array.

RPC return omits `time_tba` (present on the filter/vibe path via `CHAT_EVENT_COLUMNS`). Cast to `ChatEventPayload` is a lie.

`EventFilters` already has `venueId`. `searchEventsWithFilters` already applies it. The tool schema and the RPC do not.

### 1.4 Embeddings are thin

Canonical builder: `src/shared/lib/ai/embeddings.ts` `buildEmbeddingText`.

Capable of name + `description_es` + categories + venue + price. Import callers pass only `{ name, description_es, categories }`:

- `src/features/import/core/{ba-tourism,eventbrite,luma,meetup,passline,venti}.ts`
- `src/features/import/core/event-enrichment.ts:217`

Duplicate copies of `buildEmbeddingText` exist in `scripts/populate-embeddings.ts` and `scripts/fix-description-prefix.ts`. Delete those copies when the canonical builder is extended.

`updateEventEmbedding(eventId)` exists and has no live caller.

Enrichment prompts (`src/shared/lib/ai/enrichment.ts` `EXTRACTION_PROMPT_ES/EN`) already extract experience / atmosphere / audience / activities. That text is good semantic material. It is not structured, and most of it never reaches the embedding because callers omit venue/price and there are no facets.

No `embedding_version`. No `search_document`. No genre / vibe / activity columns. Six categories only.

### 1.5 Surprise-me is "soonest event"

Concierge prompt (`src/features/chat/api/prompts/concierge.ts:34`): `"Surprise me" → search_events limit 1`.

No-query path: `searchEventsWithFilters(filters, 1)` ordered by `starts_at`. So "surprise me" means "the soonest eligible event."

Personalization was deleted on 2026-08-08 (`user_preferences` unused). Do not revive it in this project.

### 1.6 Prompt vs schema

Prompt promises "what's on at Niceto this weekend" and "anything on Saturday?" (`concierge.ts:36`). Schema cannot express a venue or a named weekday. Vibe detection compensates by parsing those words out of `query`.

### 1.7 Evals that already exist

| Suite | What it measures | Command | Honest limitation |
| --- | --- | --- | --- |
| `evals/search/golden.ts` (24 queries) | hit@5 ≥ 0.7, mean recall@5 ≥ 0.5 via `hybridEventSearch` | `bun run eval:search` | Labels are live-DB ids from 2026-08-14. Events expire. |
| `evals/search/vibe-golden.ts` (13 queries) + `vibe-fixtures.ts` (10 fixtures) | scorer returns the fixtures that contain the same words | `bun run eval:vibe` | Proves the phrase table executes. Not that users get the best event. |
| `vibe-search.test.ts`, `search-events.test.ts` | detect / score / rank / now-mode | `bun test` | Same vocabulary loop. |

No CI. No 0–3 graded relevance. No constraint-violation metric. No frozen corpus.

### 1.8 Docs that will be wrong after this work

- `docs/decisions.md` — 2026-08-14 vibe decision. **Leave it.** New entry only.
- `docs/agent-native-architecture.md` lines 51–79 claim vibe is the design and "no hybrid fusion, RRF, or LLM retry pipeline exists by design." Update in Phase 0.

### 1.9 Missing infrastructure

- No feature-flag system. Use one env var (below). Do not add a flag framework.
- `pg_trgm` already exists for venue matching (`supabase/migrations/20260105000002_add_find_similar_venue.sql`). Reuse it; do not re-enable the extension.
- `generateObject` + `NO_THINKING` + `textModel` is the structured-LLM pattern (`src/shared/lib/ai/providers.ts`). Use it for facets and rerank. Never hand-parse JSON.

---

## 2. Target contracts

### 2.1 Intent (TypeScript)

New file: `src/features/chat/api/tools/search-intent.ts`.

```ts
export interface EventSearchMust {
  startsAfter?: string
  startsBefore?: string
  neighborhoodIds?: Neighborhood[]
  venueIds?: string[]
  isFree?: boolean
  maxPrice?: number
  attendeeAge?: number
}

export interface EventSearchPrefer {
  genres?: string[]
  vibes?: string[]
  activities?: string[]
  audience?: string[]
  setting?: string[]
}

export interface EventSearchAvoid {
  genres?: string[]
  vibes?: string[]
  activities?: string[]
  venueIds?: string[]
}

export interface EventSearchIntent {
  must: EventSearchMust
  prefer: EventSearchPrefer
  avoid: EventSearchAvoid
  semanticQuery: string
  displayLimit: number
  candidateLimit: number
  objective: 'search' | 'surprise'
}
```

`candidateLimit` default **50**. `displayLimit` default **1**, max **5** (concierge already forbids >5).

### 2.2 Tool schema (runtime)

Replace `searchEventsInputSchema` with fields the concierge can fill. The concierge **is** the intent extractor for v1. Do not add a second `generateObject` call in front of every search until Phase 8 evals show the model cannot fill these fields.

Required new fields:

- `neighborhoods: z.array(z.string()).optional()` — delete single `neighborhood`
- `venueName: z.string().optional()` and/or `venueIds: z.array(z.string()).optional()`
- `dateFrom: z.string().optional()`, `dateTo: z.string().optional()` — ISO date or datetime
- `avoid: z.array(z.string()).optional()` — free-text exclusions until facets exist
- keep `query`, `categories`, `isFree`, `maxPrice`, `minAge`, `timeFilter`, `limit`

No shims. Update `anthropicSchema` in the same file (it is a hand-copied duplicate). Update `SearchEventsToolInput` by deleting it and exporting `SearchEventsInput` from the Zod schema.

### 2.3 Canonicalization (string matching is allowed here only)

`canonicalizeSearchIntent(input, nowBA): EventSearchIntent` in `search-intent.ts`.

Allowed jobs:

- Resolve neighborhood aliases against `NEIGHBORHOODS` (case-insensitive, accent-stripped). Map "Palermo Soho" / "Palermo Hollywood" → `Palermo`.
- Resolve `venueName` via existing `searchVenuesByName` (and `find_similar_venue` if name lookup misses).
- Map free-language onto `must.isFree`: `gratis`, `gratuito`, `sin costo`, `sin cargo`, `a la gorra`, `free` — **token/phrase list used only to set a boolean**, never to rank.
- Map named weekdays and "este sábado" / "el domingo" onto `must.startsAfter/startsBefore` for the next occurrence in `America/Argentina/Buenos_Aires`.
- `dateFrom`/`dateTo` win over `timeFilter` when both are present. If both, intersect the windows. Empty intersection → no results, do not widen.
- `timeFilter` presets stay as they are in `toolInputToFilters` (tonight 18:00–06:00 with the midnight–6am exception, weekend Sat–Mon, etc.).
- Strip resolved constraint words from `semanticQuery` so "gratis en Palermo el sábado" becomes something like "event" or the remaining descriptive text. If nothing remains, `semanticQuery` is `''` and retrieval is filter-only / surprise.

Forbidden jobs:

- Scoring "romantic" / "chill" / "low-key"
- Genre classification by regex
- Quality points for having an image

### 2.4 EventFilters expansion

`src/shared/lib/types.ts` `EventFilters`:

```ts
neighborhoods?: Neighborhood[]   // replaces neighborhood
venueIds?: string[]              // replaces venueId
```

Update `searchEventsWithFilters` and `countEventsWithFilters` to use `.in()` for both. Update every callsite of `filters.neighborhood` / `filters.venueId` in the same change. No leftover single-value path.

RPC `match_events_with_venues_filtered` gains `filter_neighborhoods text[]` and `filter_venue_ids uuid[]`. Drop the single `filter_neighborhood` argument (DROP + CREATE; same pattern as `20260811130000_add_min_age_to_search.sql`). Add `time_tba` to `RETURNS TABLE` so the payload matches `CHAT_EVENT_COLUMNS`.

### 2.5 Facets (Phase 5+)

JSONB column `events.facets`, validated by Zod:

```ts
export const eventFacetsSchema = z.object({
  eventType: z.array(z.string()).default([]),
  genres: z.array(z.string()).default([]),
  activities: z.array(z.string()).default([]),
  vibes: z.array(z.string()).default([]),
  audience: z.array(z.string()).default([]),
  setting: z.array(z.string()).default([]),
  energy: z.enum(['low', 'medium', 'high']).optional(),
  socialInteraction: z.enum(['low', 'medium', 'high']).optional(),
})
```

Closed vocabularies live in `src/shared/lib/search-facets.ts` (not invented per event). Start small and bilingual-canonical (store English keys, accept Spanish at extract time):

- genres: `techno`, `house`, `jazz`, `tango`, `rock`, `folk`, `classical`, `reggaeton`, `hip-hop`, `indie`, `electronic` (extend only from eval failures)
- vibes: `intimate`, `romantic`, `relaxed`, `energetic`, `underground`, `family`, `touristy`
- activities: `live-music`, `dancing`, `dinner`, `drinks`, `workshop`, `talk`, `outdoor`, `screening`
- audience: `couples`, `friends`, `families`, `solo`, `networking`
- setting: `indoor`, `outdoor`, `seated`, `standing`
- eventType: `concert`, `party`, `class`, `festival`, `exhibition`, `food`, `sports`, `meetup`

`avoid.genres` / `prefer.vibes` become SQL `@>` / `?|` on `facets` only after this column is backfilled. Until then they stay in `semanticQuery` / the reranker.

### 2.6 Search document + embedding version

```ts
// events.search_document text
// events.embedding_version int not null default 1
```

`CURRENT_EMBEDDING_VERSION = 2` when the richer document ships.

`buildSearchDocument(event)` (replace the role of `buildEmbeddingText`, keep `buildEmbeddingText` as a wrapper that calls it so import callers do not fork):

- title
- `description_es` + `description_en` (en helps English queries; es stays primary)
- categories
- facets (joined as readable phrases)
- venue name + neighborhood
- `free` / `paid`
- eventType

Do **not** invent an artists column. Passline has artists in source data but `events` does not store them. Out of scope.

GIN index: `to_tsvector('simple', search_document)` — `simple` because the corpus is mixed es/en. Do not use `spanish` or `english` alone.

### 2.7 Retrieval functions

Rename, no alias:

| Old | New |
| --- | --- |
| `hybridEventSearch` | `semanticEventSearch` |

New:

- `lexicalEventSearch(query, filters, limit)` — FTS on `search_document` + venue name. Optional third list: `pg_trgm` on `events.name` / `venues.name` for misspellings.
- `rrfFuse(lists, k = 60, limit)` — pure function, unit-tested.
- `hybridEventSearch(query, filters, candidateLimit)` — **this time it is hybrid**: semantic + lexical (+ trigram if present) → RRF → `candidateLimit` rows.

Callers of the old name: `search-events.ts`, `evals/search/run.ts`, `search-events.test.ts` mock. Update all three. No re-export of the old name.

### 2.8 Rerank result (Phase 8)

```ts
{
  eventId: string
  relevance: 0 | 1 | 2 | 3
  constraintViolation: boolean
  matchedPreferences: string[]
  mismatchReasons: string[]
}
```

One `generateObject` call over the top 20–30 candidates. Spread `NO_THINKING`. Do not hard-code an acceptance threshold; derive it from the eval in Phase 7.

### 2.9 Score separation

Never add these into one number the way `scoreEventVibe` does:

```
semantic relevance
constraint compliance   // 0/1, filter first
content quality         // image, venue, description — final-stage prior only
freshness / soonness
popularity              // later; we have almost no signal
user affinity           // out of scope (personalization deleted)
```

---

## 3. Non-goals

- Do not grow `vibe-search.ts` phrase tables, weights, or regexes.
- Do not revive `user_preferences` / collaborative filtering.
- Do not add a cross-encoder service or a new model provider. First reranker is DeepSeek via `generateObject`.
- Do not page past `VIBE_CANDIDATE_CAP` to "fix" vibe. Vibe is leaving.
- Do not start the dev server. User already has it.
- Do not add barrel `index.ts` files.
- Do not add backwards-compat shims or keep `hybridEventSearch` as an alias.
- Do not edit old `docs/decisions.md` entries.
- Do not run `bun run build` or the full eval suite unless the phase says so.
- Do not implement Phase N+1 in the same session as Phase N.

---

## 4. Implementation order

Ship in this order so each phase is independently committable and measurable. **Phase 1 before disabling vibe**, otherwise "chill" queries regress to a single vector hit.

```
Phase 0  Decision + flag + doc correction
Phase 1  candidateLimit ≠ displayLimit          ← highest leverage
Phase 2  Schema + canonicalizeSearchIntent
Phase 3  Default vibe path OFF
Phase 4  Rename + FTS + RRF (real hybrid)
Phase 5  Facets column + extract at enrichment
Phase 6  Richer search_document + re-embed
Phase 7  Frozen eval corpus (start snapshot as soon as Phase 1 merges)
Phase 8  LLM rerank — only if Phase 7 says recall@50 is fine and NDCG@5 / Hit@1 is not
Phase 9  Surprise-me + diversity
Phase 10 Delete vibe-search.ts
```

Phase 7's *snapshot script* can be written as soon as Phase 1 merges; labels can accumulate in parallel with 4–6.

---

## Phase 0 — Decision, flag, docs

### Target

- `docs/decisions.md` — **new entry at the top** of the Decisions list
- `docs/agent-native-architecture.md` — replace the "Vibe vs. Semantic Retrieval" section (lines 51–79) with a short pointer to this plan and the new decision
- `src/features/chat/api/tools/search-events.ts` — add the flag only

### Flag

```ts
export const USE_VIBE_SCORER = process.env.SEARCH_VIBE_PATH === 'on'
```

Default **on** in Phase 0 (no behavior change). Phase 3 flips the default to off.

When `USE_VIBE_SCORER` is false, skip `detectVibeIntent` and never call `rankVibeMatches`.

### Decision text (required fields)

**Title:** Constrained Semantic Retrieval

**Date:** day of the commit

**Decision:** Vibe phrase-scoring is a temporary comparison path behind `SEARCH_VIBE_PATH`. Retrieval becomes must-filter → dense+lexical → RRF → optional LLM rerank → quality/diversity. String matching is limited to alias canonicalization.

**Alternatives considered:** keep expanding `vibe-search.ts` (rejected: second incompatible engine, false positives, unmaintainable); embeddings-only with limit=1 (rejected: retriever is not a ranker); dedicated intent-extraction LLM on every request (deferred until the expanded tool schema fails).

**Related Decision:** Vibe Search: Deterministic Scorer Over Hard-Filtered Candidates (2026-08-14).

### Acceptance

- New decision exists; old vibe decision untouched
- `SEARCH_VIBE_PATH=on` preserves today's routing
- unset / any other value: Phase 0 still uses vibe (default on)
- `docs/agent-native-architecture.md` no longer says RRF/LLM are rejected "by design"

### Verify

```
bunx tsc --noEmit
SEARCH_VIBE_PATH=on bun test src/features/chat/api/tools/search-events.test.ts
```

### Do not

- Change scoring, limits, or schema
- Touch SQL

---

## Phase 1 — Separate `candidateLimit` from `displayLimit`

Highest-leverage fix. No schema change. Vibe stays on.

### Target

- `src/features/chat/api/tools/search-events.ts`
- `src/shared/lib/db/client.ts` (`hybridEventSearch` still named that until Phase 4)
- `src/features/chat/api/tools/search-events.test.ts`

### Change

```ts
const DISPLAY_LIMIT_DEFAULT = 1
const DISPLAY_LIMIT_MAX = 5
const CANDIDATE_LIMIT = 50

const displayLimit = Math.min(input.limit ?? DISPLAY_LIMIT_DEFAULT, DISPLAY_LIMIT_MAX)
```

- Semantic path: `hybridEventSearch(query, filters, CANDIDATE_LIMIT)` then `results.slice(0, displayLimit)`.
- Filter-only path: fetch `CANDIDATE_LIMIT`, then slice to `displayLimit` (still chronological until Phase 9).
- Vibe path: keep fetching up to `VIBE_CANDIDATE_CAP` (already separated). Still return `displayLimit`.
- `now` path: same — rank or slice the full happening-now set, return `displayLimit`.
- Coverage `returned` is `results.length` after the slice.
- Telemetry `search:executed` (in `src/routes/api/chat.ts`) should grow `candidate_count` if the metadata is easy to thread through. If not, skip telemetry this phase.

Do not rerank yet. Returning the first 50 vector neighbors and then taking top-`displayLimit` by vector order is already better than asking the RPC for one row.

### Tests

Add in `search-events.test.ts`:

1. Semantic path with `limit: 1` calls `hybridEventSearch` with `50`, not `1`.
2. Returned `events.length === 1` when the mock returns 50.
3. Filter-only path: `searchEventsWithFilters` called with `50`.

### Acceptance

- A limit-1 recommendation retrieves 50 candidates
- Display count still honors `limit` (default 1, max 5)
- Vibe eval still green: `bun run eval:vibe`

### Verify

```
bunx tsc --noEmit
bun test src/features/chat/api/tools/search-events.test.ts
bun run eval:vibe
```

Optional if DB is available: `bun run eval:search` — recall@5 should not drop; it may rise because the function is now asked for 50 and the eval still reads 5. **Update `evals/search/run.ts` in this phase** so it still requests K=5 from the search function *or* requests 50 and scores the top 5. Do not silently change the metric.

Prefer: eval keeps calling `hybridEventSearch(q, {}, 5)` directly (it does not go through the tool). Then Phase 1 does not change `eval:search` numbers. Leave the runner alone.

### Do not

- Add FTS, rerank, or schema fields
- Change `detectVibeIntent`

---

## Phase 2 — Expand schema and canonicalize

### Target

- `src/features/chat/api/tools/search-intent.ts` **new**
- `src/features/chat/api/tools/search-intent.test.ts` **new**
- `src/features/chat/api/tools/search-events.ts` — schema, `toolInputToFilters` → calls canonicalize
- `src/features/chat/api/tools-ai-sdk.ts` — no change if it already imports the Zod schema
- `src/shared/lib/types.ts` — `EventFilters` + delete `SearchEventsToolInput`; `SearchEventsToolUseBlock.input` uses `SearchEventsInput`
- `src/shared/lib/db/client.ts` — multi neighborhood / venueId filters
- `src/features/chat/api/prompts/concierge.ts` — Tools section: document `neighborhoods`, `venueName`, `dateFrom`/`dateTo`, `avoid`, and that Saturday / Niceto / gratis belong in those fields, not in `query`
- New migration: drop/create `match_events_with_venues_filtered` with `filter_neighborhoods text[]`, `filter_venue_ids uuid[]`, `time_tba` in returns
- `src/features/chat/api/tools/search-events.test.ts`

Grep before editing `EventFilters.neighborhood` / `.venueId`. Update every callsite in the same PR.

### Canonicalize tests (deterministic, no DB)

Pin `now` (inject a `Date` argument). Cases:

| Input | must |
| --- | --- |
| `isFree: true` | `isFree: true` |
| query `"eventos gratis"` | `isFree: true`, semanticQuery without the free token |
| query `"freestyle rap"` | `isFree` **unset** (substring `free` must not fire) |
| query `"recital de rock"` | date intent **unset** (substring `cita` must not fire) |
| `neighborhoods: ['palermo']` | `neighborhoodIds: ['Palermo']` |
| query `"planes en san telmo"` + empty neighborhoods | `neighborhoodIds: ['San Telmo']` |
| `timeFilter: 'weekend'` on a Wednesday | Sat 00:00 → Mon 00:00 BA |
| query `"el sábado"` on a Wednesday, no timeFilter | next Saturday window |
| `dateFrom`/`dateTo` + `timeFilter` | intersection |
| `venueName: 'Niceto'` | unit-test with a mocked `searchVenuesByName` → `venueIds` |
| query `"anything except techno"` | `avoid` contains techno (or semanticQuery keeps the negation); do **not** set a techno prefer |
| `"dark comedy"` | must **not** become techno |

Reuse `normalizeText` from `vibe-search.ts` **or** move `normalizeText` to `src/shared/lib/utils/normalize-text.ts` and import from both. If you move it, update vibe-search in the same PR. Do not duplicate.

Free/weekday/neighborhood detection in canonicalize must be **token-boundary** aware (`\b` after accent-stripping), never `String.includes` on raw phrases that are substrings of unrelated words.

### Tool execute

```
intent = await canonicalizeSearchIntent(input, getNowInBA())
filters = mustToFilters(intent.must)
displayLimit = intent.displayLimit
candidateLimit = intent.candidateLimit

// then existing routing, but pass filters from must
```

Venue resolution is async (DB). Keep canonicalize async.

If `venueName` is set and resolves to zero venues, return success with zero events and a formatted note `"unknown venue: …"`. Do not silently drop the constraint.

### Acceptance

- Zod accepts `neighborhoods`, `dateFrom`, `dateTo`, `venueName`, `avoid`
- Single `neighborhood` is gone; tsc is clean
- Saturday / free / Palermo stated clearly become SQL filters, not vibe boosts, **when they arrive via the new fields or via canonicalize**
- Vibe path still runs (flag still default on) for leftover subjective query text
- Prompt no longer tells the model to stuff Niceto/Saturday into `query`

### Verify

```
bunx tsc --noEmit
bun test src/features/chat/api/tools/search-intent.test.ts src/features/chat/api/tools/search-events.test.ts
bunx supabase db push --dry-run
```

Do not `db push` unless Hanif asked this agent to apply migrations.

### Do not

- Turn vibe off
- Add FTS
- Add facets

---

## Phase 3 — Default vibe path off

### Target

- `search-events.ts` — `USE_VIBE_SCORER = process.env.SEARCH_VIBE_PATH === 'on'` already exists; **default stays that**. Behavior change: production/dev unset → vibe off. That is already true if Phase 0 used `=== 'on'`.
- Phase 0 left default **on**. This phase flips to:

```ts
export const USE_VIBE_SCORER = process.env.SEARCH_VIBE_PATH !== 'off'
```

Wait. Pick one convention and do not flip twice.

**Canonical convention (set it in Phase 0, honor it here):**

```ts
// Phase 0–2: default ON
export const USE_VIBE_SCORER = process.env.SEARCH_VIBE_PATH !== 'off'

// Phase 3: default OFF
export const USE_VIBE_SCORER = process.env.SEARCH_VIBE_PATH === 'on'
```

Phase 3 is the flip to `=== 'on'`.

- `search-events.test.ts` — existing now-mode vibe test must set `SEARCH_VIBE_PATH=on` (vitest `vi.stubEnv` or a small setter). Add a test that unset env + query `"chill tonight"` goes to **semantic** (mocked `hybridEventSearch` / later `semanticEventSearch`), not vibe.
- `evals/search/vibe-run.ts` still tests the pure scorer; it does not need the flag. Keep the suite.

### Acceptance

- Unset env: no `rankVibeMatches` in the tool
- `SEARCH_VIBE_PATH=on`: previous vibe tests pass
- `"eventos gratis"` still filters `is_free` via canonicalize (Phase 2), even with vibe off

### Verify

```
bunx tsc --noEmit
bun test src/features/chat/api/tools/search-events.test.ts src/features/chat/api/tools/search-intent.test.ts
SEARCH_VIBE_PATH=on bun run eval:vibe
```

### Do not

- Delete `vibe-search.ts`
- Change retrieval

---

## Phase 4 — Real hybrid search (rename + FTS + RRF)

### Target

- New migration: `search_document` (nullable text, backfilled in Phase 6), GIN tsvector index, `lexical_match_events_with_venues` RPC mirroring the semantic filter args
- `src/shared/lib/search/rrf.ts` **new** — `rrfFuse`
- `src/shared/lib/search/rrf.test.ts` **new**
- `src/shared/lib/db/client.ts` — rename `hybridEventSearch` → `semanticEventSearch`; add `lexicalEventSearch`; add new `hybridEventSearch` that fuses
- `search-events.ts` — semantic-mode queries call the **new** `hybridEventSearch(query, filters, candidateLimit)`
- `evals/search/run.ts` — import rename; decide whether the golden set runs against `semanticEventSearch` (old behavior) or `hybridEventSearch` (new). Run **both** in this phase as `eval:search` (hybrid) and keep a `--semantic-only` path or a second script `eval:search:semantic` so regressions isolate.
- `search-events.test.ts` mocks

Until Phase 6 backfill, `search_document` may be null. Lexical RPC must fall back to `coalesce(search_document, name || ' ' || coalesce(description_es,''))` so Phase 4 works on today's rows.

### RRF

```ts
export function rrfFuse<T extends { id: string }>(
  rankedLists: T[][],
  options?: { k?: number; limit?: number }
): T[]
```

`k` default 60. First occurrence of an id keeps that object. Test:

- two lists, shared id in rank 1 and rank 3 beats unique rank 2
- empty lists
- duplicate ids inside one list ignored
- limit truncates

### Lexical RPC

`websearch_to_tsquery('simple', query)` against `to_tsvector('simple', document)`. Filter args identical to semantic RPC (including `filter_neighborhoods`, `filter_venue_ids`, `time_tba` in returns). `ORDER BY ts_rank_cd(...) DESC`.

Optional third list this phase only if cheap: `similarity(e.name, query) > 0.3` using existing `pg_trgm`. Skip if it blows the migration. Add in a follow-up, not in the same Flash session if the RPC is already large.

### Acceptance

- Zero remaining identifiers named `hybridEventSearch` that only do vector search
- New `hybridEventSearch` calls both retrievers when `semanticQuery` is non-empty
- Filter-only / empty query does not embed
- `rrf.test.ts` green
- `bun run eval:search` (hybrid) hit@5 does not fall below the previous semantic threshold on the current DB. If it does, report the failing queries; do not "fix" by adding vibe terms.

### Verify

```
bunx tsc --noEmit
bun test src/shared/lib/search/rrf.test.ts src/features/chat/api/tools/search-events.test.ts
bunx supabase db push --dry-run
# if Hanif applied the migration and DB is available:
bun run eval:search
```

### Do not

- Re-embed
- Add facets
- Add LLM rerank
- Leave a `hybridEventSearch` alias pointing at the old function

---

## Phase 5 — Structured facets at enrichment

### Target

- Migration: `events.facets jsonb not null default '{}'::jsonb` + GIN index
- `src/shared/lib/search-facets.ts` — vocabularies + Zod schema
- `src/shared/lib/types.ts` — `Event.facets`, `EventInsert.facets`
- `src/shared/lib/ai/extract-facets.ts` **new** — `extractEventFacets({ name, description_es, description_en, categories })` via `generateObject` + `NO_THINKING` + closed enums
- `src/features/import/core/event-enrichment.ts` — after descriptions exist, extract facets, persist
- Import cores that already have descriptions at insert time (Venti, BA Tourism, Eventbrite): call extract **or** leave `facets = {}` and let the enrich job fill them. Prefer the enrich job so insert stays fast. Then `getEventsNeedingEnrichment` must also select rows with empty facets, not only missing descriptions.
- `scripts/backfill-facets.ts` **new** — batch `extractEventFacets` for scheduled events with `facets = {}`. Respect rate limits. Idempotent.

### Extractor rules

- Only assign a key if the source text supports it. Empty arrays are correct.
- Do not infer `romantic` from "dinner" alone.
- Spanish and English descriptions both passed in.
- On `generateObject` failure: write `{}` and log; do not fail the whole enrich.

### Acceptance

- New events leaving enrichment have non-`{}` facets when the description contains clear genre/vibe evidence
- Closed vocabulary: a facet value not in the enum cannot be stored (Zod)
- Backfill script can be dry-run (`--limit 10`)

### Verify

```
bunx tsc --noEmit
bun test src/shared/lib/ai/extract-facets.test.ts
```

Unit-test the schema (reject unknown genre). Mock `generateObject` for the extractor. Do not call DeepSeek in unit tests.

### Do not

- Re-embed yet
- SQL-filter on facets yet (backfill will be incomplete)
- Expand `CATEGORIES`

---

## Phase 6 — Richer documents and re-embed

### Target

- `src/shared/lib/ai/embeddings.ts` — `CURRENT_EMBEDDING_VERSION = 2`, `buildSearchDocument`, `buildEmbeddingText` delegates to it
- All `generateEventEmbedding({ name, description_es, categories })` callers pass venue + price + facets when they have them. If the insert path does not have venue yet, pass what it has; enrichment already re-embeds.
- Delete duplicate builders in `scripts/populate-embeddings.ts` and `scripts/fix-description-prefix.ts`
- `scripts/reembed-stale.ts` **new** (or extend `populate-embeddings.ts` to filter `embedding_version < CURRENT` or `embedding_version is null`)
- Migration: `embedding_version int not null default 1`, trigger or application-level write of `search_document` whenever embedding is written
- Write `search_document` in the same update as the new embedding
- `scripts/reembed-stale.ts` must write via the **service-role client** (`getSupabaseServiceRoleClient()`): the anon role has no RLS `UPDATE` on `events`, so anon writes are silently dropped (stale rows stay stale no error). Reads may use anon.

### Acceptance

- One builder in the repo
- A venti-like event with venue+neighborhood+free+facets produces a document containing those tokens
- Reembed script updates `embedding` + `search_document` + `embedding_version`
- Import path still works if facets are `{}`

### Verify

```
bunx tsc --noEmit
bun test src/shared/lib/ai/embeddings.test.ts
```

Add `embeddings.test.ts` for `buildSearchDocument` (pure).

Do not run the full re-embed against production from a Flash agent unless Hanif's task says so.

### After this phase

`prefer` / `avoid` genres and vibes may be applied as SQL on `facets` in `mustToFilters` / a new `applyPreferAvoid`. Avoid = hard exclude. Prefer = not a filter; leave it for rerank / hybrid query text.

Thread prefer into `semanticQuery` by appending joined prefer terms if the user-facing query is empty.

Avoid = a hard exclude. At the SQL layer the search RPCs (`match_events_with_venues_filtered`, `lexical_match_events_with_venues`) use
`NOT (coalesce(facets->'genres','[]') ?| filter_avoid_genres)` — the `coalesce` keeps events without a `genres` key eligible (a raw `NOT (facets->'genres' ?| arr)` would NULL-exclude every event with `facets = {}`).
On the PostgREST filter-only / count paths there is **no** valid JSONB-overlap filter (`.not('facets->genres','ov',arr)` errors with `operator does not exist: jsonb && unknown`, and `cs` mishandles missing genres), so applying avoid there is done **in memory** via `applyAvoidGenres` after fetching. Events with empty/missing facets stay eligible unless they actually carry an avoided genre.

---

## Phase 7 — Evaluation that measures the product

Do **not** delete `vibe-golden.ts` until Phase 10. It still guards the comparison path.

### 7a. Frozen corpus (do this as soon as Phase 1 has merged; can parallelize with 4–6)

New: `evals/search/corpus/`

- `scripts/snapshot-search-corpus.ts` — dump N scheduled upcoming events (id, name, descriptions, categories, facets, venue, neighborhood, starts_at, is_free, price, image_url, location_tba) to `evals/search/corpus/events.json`. No embeddings required if the eval runner re-embeds in memory **or** stores the snapshot embedding. Prefer storing the raw fields and building documents at eval time so Phase 6 can be measured without re-snapshotting.
- Commit the snapshot. Refresh only when Hanif asks. Label file references snapshot ids, not live DB.

### 7b. Query set (~100 to start, grow to 300)

`evals/search/relevance/queries.ts`

Cover, in en / es / mixed:

- Hard constraints: free, Saturday, Palermo, Niceto, tonight, age
- Argentine slang: `finde`, `tranqui`, `a la gorra`, `after`, `previa`
- Misspellings and missing accents: `Palermo`, `Palermo`, `niceto`, `tecnó`
- Named venues and performers (from the snapshot)
- Negation: `anything but techno`, `algo que no sea reggaeton`
- Composition: `lively but somewhere we can talk`, `romantico pero no caro`
- Near-midnight (`timeFilter: tonight` after 00:30)
- Impossible: `free opera in a villa on a Monday at 6am` → no-match
- Vague: `pick somewhere good`, `sorpresa`

Each query:

```ts
{
  id: string
  query: string
  toolInput?: Partial<SearchEventsInput>  // optional explicit fields
  labels: Record<eventId, 0 | 1 | 2 | 3>
  must?: { isFree?: boolean; weekday?: number; neighborhood?: string; venueId?: string }
  expectEmpty?: boolean
}
```

0 = irrelevant, 1 = marginally, 2 = good, 3 = exact.

Flash agents must **not** invent 300 labels. Phase 7a ships the snapshot + 20 hand-labeled seed queries (include the failure classes above). Remaining labels are a Hanif / later-agent pass.

### 7c. Metrics runner

`evals/search/relevance/run.ts` + `bun run eval:relevance`

Track separately:

| Metric | How |
| --- | --- |
| Structured-intent accuracy | canonicalize output vs `must` on the case |
| Hard-constraint violation rate | any returned event that breaks `must` |
| Recall@50 | any label ≥ 2 in the candidate set |
| NDCG@5 | graded |
| Hit@1 / precision@1 | for `displayLimit = 1` cases |
| No-match accuracy | `expectEmpty` |
| Latency / candidate counts | log only |

Do not LLM-grade in v1. Human labels only.

Thresholds: set after the first run against Phase 4+6. Do not copy vibe-golden's binary pass/fail.

### Acceptance (7a+seed)

- Snapshot file exists and is deterministic
- 20 labeled queries run offline against in-memory or DB-replayed retrieval
- Runner prints the metric table
- Constraint-violation rate is reported even if 0

### Verify

```
bun evals/search/relevance/run.ts
```

### Do not

- Point this runner at the live mutating events table as the source of truth
- Calibrate an LLM judge yet

---

## Phase 8 — LLM rerank (gate)

**Do not start** unless Phase 7 on the post-Phase-4/6 system shows:

- Recall@50 is acceptable (candidates contain the good events)
- NDCG@5 or Hit@1 is the failure

### Target

- `src/features/chat/api/tools/rerank-events.ts` **new**
- Called only after hybrid fusion, on `min(30, candidates.length)`
- `generateObject` + schema in §2.8 + `NO_THINKING`
- Sort by `relevance` desc, drop `constraintViolation: true`, then slice `displayLimit`
- Timeout / model failure: fall back to fused order (do not fail the search)
- Telemetry: `search_mode: 'hybrid+rerank'`, `rerank_ms`

Prompt the model with: user semanticQuery, must/prefer/avoid, and for each event: id, name, summaries, neighborhood, venue, categories, facets, is_free, starts_at. Not raw 2k-word descriptions.

### Acceptance

- Eval Hit@1 / NDCG@5 improve vs Phase 7 baseline on the same corpus
- Constraint-violation rate does not increase
- Failure path returns fused order
- Cost: one LLM call per search, not per event

### Verify

```
bun test src/features/chat/api/tools/rerank-events.test.ts
bun evals/search/relevance/run.ts
```

Mock `generateObject` in unit tests.

### Do not

- Hard-code `relevance >= 2` as a ship gate without looking at the eval
- Rerank the vibe path

---

## Phase 9 — Surprise-me, quality, diversity

Only after relevance is measured. Quality must not leak into "is this romantic."

### Surprise-me

Trigger: `objective === 'surprise'` when `query` is empty **and** no `must` other than the default upcoming window, **or** the concierge uses a new `objective: 'surprise'` field (add to schema this phase).

Candidate strategy over the filtered upcoming set (cap 50):

```
quality(image, !location_tba, !description_unavailable, has venue)
+ soonness (not "the soonest", a decay over the next 7 days)
− events already shown in this conversation (if event ids are available on the tool context; otherwise skip)
− near-duplicate names / same venue
```

Return 1. Not chronological.

### Diversity (lists only, `displayLimit > 1`)

After ranking, greedy MMR-style pass: cap 2 events per `venue_id`, cap 3 per identical `categories` signature. Fill from remaining candidates.

### Acceptance

- `"surprise me"` with empty query is not "the soonest event" in tests with a fixture set where the soonest event is location_tba / no image and a later event is complete
- A 4-event list does not return 4 events from the same venue if alternatives exist
- Quality still does not affect the semantic path's relevance order until this stage

### Verify

```
bun test src/features/chat/api/tools/search-events.test.ts
bunx tsc --noEmit
```

### Do not

- Bring back saved-event personalization
- Add popularity until there is a real signal (saves/clicks)

---

## Phase 10 — Delete the vibe scorer

Only after:

- `SEARCH_VIBE_PATH=on` has been unused in production (Hanif confirms), or Hanif explicitly wants it gone
- Phase 7 constraint-violation and Hit@1 beat the vibe-on comparison on the frozen set

### Delete

- `src/features/chat/api/tools/vibe-search.ts`
- `vibe-search.test.ts`
- `evals/search/vibe-*.ts` and `package.json` `eval:vibe`
- `USE_VIBE_SCORER` and every `searchMode: 'vibe'` branch
- Mentions in `docs/agent-native-architecture.md`

Move `normalizeText` to shared **before** deleting if Phase 2 did not already.

New decision: "Removed vibe scorer; constrained semantic retrieval is the only path." Related: this plan's Phase 0 decision.

### Verify

```
bunx tsc --noEmit
bun test
```

---

## 5. Dispatch notes for pi / DeepSeek V4 Flash

One phase per agent. Paste this block plus the phase section.

```
Repo: /Users/hanifcarroll/projects/ba-events
Runtime: Bun only. Never start the dev server.
Read first: AGENTS.md, docs/constrained-semantic-retrieval-plan.md (the assigned phase + §§1–3).
Do not implement any later phase.
No barrel imports. No shims. No leftover aliases.
After code changes: bunx tsc --noEmit and the phase Verify commands.
If a migration is required: write it under supabase/migrations/, bunx supabase db push --dry-run, do not push unless the task says apply.
New architectural fact → new entry in docs/decisions.md, never edit an old one.
Skip formatters/linters beyond tsc unless a file you touched is already in a local test command.
```

If a phase needs a judgment call (closed vocabulary additions, rerank threshold, "is this slang a hard constraint"), stop and report. Do not invent weights.

### Suggested pi task titles

0. `search-phase-0-decision-flag`
1. `search-phase-1-candidate-limit`
2. `search-phase-2-schema-canonicalize`
3. `search-phase-3-vibe-default-off`
4. `search-phase-4-fts-rrf`
5. `search-phase-5-facets`
6. `search-phase-6-reembed`
7. `search-phase-7-frozen-eval`
8. `search-phase-8-rerank` (gated)
9. `search-phase-9-surprise-diversity`
10. `search-phase-10-delete-vibe`

---

## 6. File map

| Area | Files |
| --- | --- |
| Tool + routing | `src/features/chat/api/tools/search-events.ts`, `search-events.test.ts`, `tools-ai-sdk.ts`, `prompts/concierge.ts` |
| Intent | `src/features/chat/api/tools/search-intent.ts` (new) |
| Vibe (doomed) | `src/features/chat/api/tools/vibe-search.ts` |
| DB client | `src/shared/lib/db/client.ts` |
| Types | `src/shared/lib/types.ts` (`EventFilters`, dead `SearchEventsToolInput`, `Event.facets`) |
| Embeddings | `src/shared/lib/ai/embeddings.ts` |
| Facets | `src/shared/lib/search-facets.ts`, `src/shared/lib/ai/extract-facets.ts` |
| RRF | `src/shared/lib/search/rrf.ts` |
| Rerank | `src/features/chat/api/tools/rerank-events.ts` |
| Enrichment | `src/features/import/core/event-enrichment.ts` + six import cores |
| SQL | new files under `supabase/migrations/`; do not rewrite old hybrid migrations |
| Telemetry | `src/routes/api/chat.ts` (`search:executed`), `docs/analytics.md` |
| Evals | `evals/search/*` |
| Scripts | `scripts/backfill-facets.ts`, `scripts/reembed-stale.ts`, `scripts/snapshot-search-corpus.ts` |
| Docs | `docs/decisions.md` (append), `docs/agent-native-architecture.md`, this file |

---

## 7. Risks

- **Live semantic golden set is stale.** Do not treat `eval:search` failures after a DB refresh as retrieval regressions without checking ids in `inspect-events.ts`.
- **Corpus is small.** Exhaustive filter + in-memory rank would still work today. We still add FTS+RRF because named venues/artists and the prompt's Niceto/Saturday cases are lexical, and because vibe is being removed. Do not add paging.
- **DeepSeek structured output is compatibility-mode JSON.** Facet extraction and rerank must use `generateObject` repair, closed enums, and a fallback (`{}` / fused order). See the categorizer decision in `docs/decisions.md`.
- **Re-embed cost.** `text-embedding-3-small` over the full catalog is the expensive step. Phase 6 is a script, not a request-path job.
- **Flag convention.** Phase 0 and Phase 3 must not disagree. `SEARCH_VIBE_PATH=on` means vibe is active. After Phase 3, unset means vibe is dead.
- **Type drift will return** if someone updates Zod and forgets `anthropicSchema`. Change both in the same edit, or delete `anthropicSchema` if nothing reads it (grep first; if unused, delete in Phase 2).

---

## 8. What "done" means for the project

A user can say "algo barato y tranqui en Palermo mañana, pero no techno" and the system:

1. Filters Palermo + tomorrow + max price in SQL
2. Excludes techno via facets (or rerank negation if facets missed)
3. Retrieves ~50 lexical+dense candidates
4. Reranks for "tranqui"
5. Returns 1–4 events that actually match, not a soonest paid rave that contained the letters `cita`

Until Phase 7 can measure that, do not declare victory because `eval:vibe` is green.

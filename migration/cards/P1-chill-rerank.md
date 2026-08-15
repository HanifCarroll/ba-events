# Card P1 — chill soft ranking

## Objective

When the user asks for something chill / tranquilo / relaxed, prefer events
tagged relaxed / low energy and push parties and high-energy events down.
**Do not hide** events that have no tags. This is ranking, not a filter.

## Root cause (verified)

`search_events` leaves “chill” in `semanticQuery`. `hybridEventSearch` ranks
by embedding + lexical RRF only. `facets.vibes` / `facets.energy` /
`facets.eventType` exist on rows but are never used to order results.
`applyPreferAvoid` only hard-excludes **genres**.

## Required changes

### 1. Detect a chill ask (intent only, no scoring of events)

In `src/features/chat/api/tools/search-intent.ts`, after canonicalize, expose
a small helper (new export, used by the tool):

```ts
export function detectChillIntent(semanticQuery: string): boolean
```

True when a **whole token** (normalized, accent-stripped) is one of:
`chill`, `tranqui`, `tranquilo`, `tranquila`, `relajado`, `relajada`,
`relaxed`, `lowkey`, `low-key`, `calmado`, `suave`.

Do **not** substring-match (`cita` in `recital` must stay false).
Do **not** put this in the regex vibe scorer that was deleted. Token set only.
Do **not** turn this into a SQL filter.

### 2. Soft rerank

In `src/features/chat/api/tools/quality-diversity.ts`:

Extend `SearchScoreable` with optional:

```ts
facets?: {
  vibes?: string[]
  energy?: 'low' | 'medium' | 'high'
  eventType?: string[]
} | null
```

`ChatEventPayload` already includes `facets` via `EventWithVenue`.

Add:

```ts
export function chillRerank<T extends SearchScoreable>(events: T[]): T[]
```

Stable sort. Score each event (higher first):

- `+2` if `facets.vibes` includes `relaxed` or `intimate`
- `+2` if `facets.energy === 'low'`
- `+1` if `facets.eventType` includes `class` or `exhibition` (typically calmer)
- `-3` if `facets.eventType` includes `party`
- `-2` if `facets.energy === 'high'`
- `-1` if `facets.vibes` includes `energetic`
- `0` if `facets` is missing/empty (untagged stays in place relative to other
  untagged; they only move when a tagged neighbor has a non-zero score)

Keep original order when scores tie (stable).

Do **not** drop any event. Do **not** call this on the surprise path.

### 3. Wire it

In `searchEventsTool.execute`, on the **semantic** path only, after
`hybridEventSearch` and **before** `applyDiversity` / `slice`:

```
if (detectChillIntent(query)) {
  candidates = chillRerank(candidates)
}
```

Also apply on the `timeFilter === 'now'` branch when there is a semantic
query that detects chill (same helper), before diversity/slice.

Filter-only (no query) and surprise: no change.

## Tests

- `detectChillIntent('chill tonight')` true
- `detectChillIntent('algo tranquilo')` true
- `detectChillIntent('recital de rock')` false
- `chillRerank([party-high, untagged, relaxed-low])` order:
  relaxed-low, untagged, party-high
- `search-events.test.ts`: a `query: 'chill'` semantic call must pass the
  hybrid mock’s return through a rerank that puts the relaxed fixture first.
  Add `facets` to the mock events.

## Do not

- Add `filter_vibes` / `filter_energy` RPC parameters.
- Hard-exclude untagged or party events.
- Revive `vibe-search.ts` phrase scoring.
- Change embeddings, enrichment, or guest chat.
- Add deps. No git. No `vite dev`.

## Acceptance

1. `bunx vitest run src/features/chat/api/tools` passes (including new cases).
2. `bunx tsc --noEmit` — zero errors in files you touched.
3. Evidence: `migration/evidence/P1-chill-rerank.md` with the token list, the
   score table, and a quoted test that proves a party loses to a relaxed event
   without being dropped.

## Boundaries

`src/features/chat/api/tools/search-intent.ts`,
`src/features/chat/api/tools/search-intent.test.ts`,
`src/features/chat/api/tools/quality-diversity.ts`
(and its test file; create `quality-diversity.test.ts` if missing),
`src/features/chat/api/tools/search-events.ts`,
`src/features/chat/api/tools/search-events.test.ts`,
evidence file.

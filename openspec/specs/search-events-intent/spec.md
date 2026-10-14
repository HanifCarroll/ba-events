## Purpose

Define the current `search_events` intent boundary: canonicalize user/tool input into hard constraints and retrieval signals, then execute bounded searches whose evidence is deterministic and inspectable.

## REQUIREMENTS

### Requirement: Preserve non-negotiable search constraints

`search_events` MUST canonicalize dates and time windows, neighborhoods, venues, categories, price/free status, age, and explicit genre exclusions as hard constraints. Hard constraints MUST be applied to retrieval/filter operations and MUST NOT be silently dropped; an unresolved named venue yields zero results with an explanatory note.

#### Scenario: Hard constraints reach retrieval
- **WHEN** a request includes free status, a neighborhood, category, date/time bounds, venue identity, age, price, or an explicit genre exclusion
- **THEN** the corresponding canonical `must` constraints are converted to search filters and the search does not widen or discard them

#### Scenario: Paid-only search reaches semantic and lexical retrieval
- **WHEN** the effective free-status constraint is explicitly false
- **THEN** semantic and lexical database requests retain false rather than converting it to an unconstrained null
- **AND** true remains free-only and an omitted constraint remains unconstrained

#### Scenario: Unresolved venue remains constrained
- **WHEN** a named venue resolves to no venue ids
- **THEN** `search_events` returns a successful zero-event result with an `unknown venue` note and does not run event retrieval

#### Scenario: An empty result triggers a broader retry
- **GIVEN** a search established effective hard constraints within the current user turn
- **WHEN** another search would drop or widen a neighborhood, venue, category, free-only status, budget, age restriction, date window, happening-now scope, or genre exclusion
- **THEN** the server rejects that retry before event retrieval
- **AND** the previous successful empty result remains authoritative
- **AND** a new user turn may explicitly change the requested constraints

#### Scenario: A retry preserves the search boundary
- **WHEN** a retry changes subjective wording but keeps equivalent or narrower effective hard constraints
- **THEN** it remains eligible within the existing tool and time limits
- **AND** concurrent search calls cannot bypass the boundary by starting before the first search returns

### Requirement: Separate subjective retrieval signals from hard constraints

`search_events` MUST keep subjective query residue and `prefer` facets as retrieval/reranking signals, not hard filters. Query facet extraction MUST be token/phrase bounded, and semantic retrieval MUST use the remaining `semanticQuery`; preference signals MAY be appended as retrieval text when no semantic residue remains.

#### Scenario: Subjective intent does not become a filter
- **WHEN** a request contains vibe, genre, activity, audience, or setting language without a corresponding hard constraint
- **THEN** those signals remain in `semanticQuery`/`prefer` for retrieval or reranking and do not become SQL filters

#### Scenario: Live music does not imply a genre exclusion
- **WHEN** a user asks for live music or live jazz without an electronic-genre exclusion
- **THEN** live music remains a preference and no electronic genre is added to hard exclusions
- **AND** an explicitly requested electronic-genre exclusion still reaches retrieval

#### Scenario: Resolvable syntax is consumed without losing specific residue
- **WHEN** a query combines generic discovery, temporal, neighborhood, or free-language syntax with a specific term
- **THEN** only the recognized syntax is consumed, the specific semantic residue remains, and the request uses semantic retrieval when residue remains

### Requirement: Bound candidate and display work

`search_events` MUST keep the candidate retrieval cap separate from the display limit: display results are clamped to 1–5, while normal retrieval fetches at most 50 candidates before ranking and slicing. Surprise mode returns exactly one result; disjoint weekday windows are fetched separately and merged with a global cap of 50.

#### Scenario: Limit-one search still retrieves bounded candidates
- **WHEN** a normal semantic or filter-only request asks for one displayed event
- **THEN** retrieval is invoked with a candidate limit of 50 and the returned list is sliced to the display limit

#### Scenario: Disjoint weekday requests stay disjoint and bounded
- **WHEN** a request names multiple weekdays
- **THEN** each weekday window is searched separately, results are merged without duplicate ids in round-robin order, and the merged candidate set is capped at 50 rather than using a spanning date hull

#### Scenario: Surprise cardinality is fixed
- **WHEN** objective `surprise` is valid for the request
- **THEN** the search uses surprise ranking and returns exactly one event, regardless of a larger display limit

### Requirement: Emit deterministic search evidence

`search_events` MUST return metadata describing the retrieval mode, displayed count, event ids, zero-result state, and coverage (`searchedFrom`/`searchedTo` or exact `searchedWindows`, `totalMatches`, returned count, and maximum event date). Ranking and diversity MUST preserve deterministic fallback/order behavior when hosted reranking is unavailable, and the result MUST be built from the canonicalized, bounded search path.

#### Scenario: Coverage distinguishes searched windows from returned events
- **WHEN** a search runs with a scalar window or disjoint weekday windows
- **THEN** metadata reports the actual searched bounds, exact disjoint windows without a spanning hull, total matches, returned count, and the furthest event date

#### Scenario: Disabled reranking keeps retrieval order
- **WHEN** hosted reranking is unavailable or disabled
- **THEN** the search preserves the deterministic retrieval order while still applying the requested display cap and list-diversity behavior

## Verification

### Implementation anchors
- `src/features/chat/api/tools/search-intent.ts`
- `src/features/chat/api/tools/search-events.ts`
- `src/features/chat/api/tools/search-ranking.ts`
- `src/shared/lib/search/rerank.ts`

### Deterministic tests
- `src/features/chat/api/tools/search-intent.test.ts`
- `src/features/chat/api/tools/search-events.test.ts`
- `src/features/chat/api/tools/search-query-annotations.test.ts`
- `src/shared/lib/search/rerank.test.ts`

### Verification command
```sh
bunx vitest run src/features/chat/api/tools/search-intent.test.ts src/features/chat/api/tools/search-events.test.ts src/features/chat/api/tools/search-query-annotations.test.ts src/shared/lib/search/rerank.test.ts
```

### Advisory conformance review
`$openspec-review-conformance search-events-intent` compares these requirements with implementation and deterministic evidence; the review is advisory rather than proof.

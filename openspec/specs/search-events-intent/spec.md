## Purpose

Define the current `search_events` intent boundary: canonicalize user/tool input into hard constraints and retrieval signals, then execute bounded searches whose evidence is deterministic and inspectable.

## REQUIREMENTS

### Requirement: Preserve non-negotiable search constraints

`search_events` MUST canonicalize dates and time windows, neighborhoods, venues, categories, price/free status, age, and explicit genre exclusions as hard constraints. Hard constraints MUST be applied to retrieval/filter operations and MUST NOT be silently dropped; an unresolved named venue yields zero results with an explanatory note.

#### Scenario: Hard constraints reach retrieval
- **WHEN** a request includes free status, a neighborhood, category, date/time bounds, venue identity, age, price, or an explicit genre exclusion
- **THEN** the corresponding canonical `must` constraints are converted to search filters and the search does not widen or discard them

#### Scenario: Unresolved venue remains constrained
- **WHEN** a named venue resolves to no venue ids
- **THEN** `search_events` returns a successful zero-event result with an `unknown venue` note and does not run event retrieval

### Requirement: Separate subjective retrieval signals from hard constraints

`search_events` MUST keep subjective query residue and `prefer` facets as retrieval/reranking signals, not hard filters. Query facet extraction MUST be token/phrase bounded, and semantic retrieval MUST use the remaining `semanticQuery`; preference signals MAY be appended as retrieval text when no semantic residue remains.

#### Scenario: Subjective intent does not become a filter
- **WHEN** a request contains vibe, genre, activity, audience, or setting language without a corresponding hard constraint
- **THEN** those signals remain in `semanticQuery`/`prefer` for retrieval or reranking and do not become SQL filters

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

# Event Import and Enrichment Specification

## Purpose
Define source-specific event ingestion, duplicate handling, venue settlement, and bounded enrichment without fabricating unavailable source facts.

## Requirements

### Requirement: Imports preserve source identity
Every imported event MUST retain its source and stable external identity where available. Existing source identities SHALL update the matching event instead of creating a duplicate.

#### Scenario: Existing external event is imported again
- **WHEN** source and external identity match a stored event
- **THEN** the existing record is updated through the source-specific path

### Requirement: Source adapters preserve source semantics
Each source SHALL use its registered transformer and enrichment capabilities. Source-specific time-TBA, hidden-location, description, ticket, category, and venue states MUST NOT be normalized into unsupported certainty.

#### Scenario: Source has no verified start time
- **WHEN** its adapter cannot establish a time
- **THEN** the event retains its date with time TBA rather than invented midnight certainty

### Requirement: Venue settlement is deterministic and reviewable
Venue matching SHALL prefer valid existing identities and SHALL leave ambiguous or invalid candidates for review rather than silently attach an unrelated venue.

#### Scenario: Venue match is ambiguous
- **WHEN** no candidate satisfies the settlement rules
- **THEN** import does not claim an unsupported venue match

### Requirement: Enrichment is bounded and source-backed
Enrichment SHALL use the registered source strategy, retain available source data on partial failure, and mark unavailable descriptions or terminal failures explicitly. It MUST NOT invent event facts to make a record appear complete.

#### Scenario: Native description exists
- **WHEN** a source already provides usable Spanish description text
- **THEN** the translate-only path may create the English presentation without re-scraping for a replacement description

## Verification

### Implementation anchors
- `src/features/import/adapters/enrichment/registry.ts`
- `src/features/import/core/event-enrichment.ts`
- `src/features/import/api/duplicate-detection.ts`
- `src/features/import/core/venue-settlement.ts`
- `src/trigger/jobs/daily-scrape.ts`

### Deterministic tests
- `src/features/import/core/event-enrichment.test.ts`
- `src/features/import/api/duplicate-detection.test.ts`
- `src/features/import/core/passline-existing.test.ts`
- `src/trigger/jobs/daily-scrape-outcome.test.ts`

### Verification command
```sh
bunx vitest run src/features/import/core/event-enrichment.test.ts src/features/import/api/duplicate-detection.test.ts src/features/import/core/passline-existing.test.ts src/trigger/jobs/daily-scrape-outcome.test.ts
```

### Advisory conformance review
`$openspec-review-conformance event-import-enrichment` is advisory rather than proof.

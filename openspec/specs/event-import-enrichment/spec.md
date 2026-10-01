# Event Import and Enrichment Specification

## Purpose
Define source-specific event ingestion, duplicate handling, venue settlement, and bounded enrichment without fabricating unavailable source facts.

## Requirements

### Requirement: Imports preserve source identity
Every imported event MUST retain its source and stable external identity where available. Existing source identities SHALL update the matching event instead of creating a duplicate.

#### Scenario: Existing external event is imported again
- **WHEN** source and external identity match a stored event and source or embedding inputs changed
- **THEN** the existing record is updated through the source-specific path

#### Scenario: Existing external event is unchanged
- **WHEN** source and external identity match a stored event with current embedding inputs and no mutable source changes
- **THEN** the importer performs no write, categorization, presentation generation, or embedding

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

### Requirement: Catch-up retries are bounded per scheduled chain
The scheduled catch-up SHALL include retryable `failed` events in its first batch, then select only `pending` events in chained batches. A failed event MUST be attempted at most once per scheduled catch-up chain and remain eligible for a later scheduled run.

#### Scenario: Failed event remains retryable without looping
- **WHEN** an event selected in the first catch-up batch fails enrichment and another batch is chained
- **THEN** the next batch excludes that failed event, while the event remains eligible for the next scheduled catch-up

### Requirement: Daily discovery exhausts the source window
Daily imports SHALL acquire the full configured discovery window without deferring new events to satisfy a proxy quota. Passline SHALL use its published country pagination until an empty terminal page, validate every page, deduplicate identical source identities, and fail incomplete observations rather than treating a capped home feed as a complete country catalog. Daily enrichment chains SHALL be sized to their observed eligible set. Meetup date filtering SHALL include the complete last calendar day in Buenos Aires time.

#### Scenario: Passline home feed is capped
- **WHEN** more events exist than the home feed exposes
- **THEN** country pagination retains the additional eligible identities before existing CABA, date, blocklist, and unchanged-event rules apply

#### Scenario: A discovery day or page fails
- **WHEN** bounded acquisition retries cannot complete a required page or day
- **THEN** the source reports failure rather than success with an incomplete observation

### Requirement: Browser acquisition has explicit ownership and retry reuse
Production Meetup discovery SHALL use configured Cloudflare Browser Rendering, retain direct HTTP detail reads, and SHALL NOT silently fall back to a paid provider after a Cloudflare failure. Passline SHALL retain Browserbase for challenged pages, proxy only Passline domains, block nonessential resources, and retry a failed thin detail profile once with its standard resource profile. Every owned browser SHALL be released and its provider closure checked. Successful anonymous source acquisitions SHALL be reused within the same Trigger run and across its retries, while a new daily run SHALL make fresh source observations. Failed acquisitions SHALL NOT be cached as success. A successful protected detail MAY also be reused by another same-day catch-up run after a downstream failure; its day partition SHALL reset at Buenos Aires midnight. Browser-consuming enrichment batches SHALL share the acquisition queue.

#### Scenario: Database or AI processing fails after a complete acquisition
- **WHEN** the same Trigger run retries with a valid retained acquisition
- **THEN** downstream processing reuses that source observation without repeating paid browser reads

### Requirement: Conditional HTTP caching preserves daily freshness
Anonymous Meetup detail HTML MAY be stored privately with validators. Each new run SHALL revalidate it; a 304 SHALL retain the previously observed source text, while a new 200 SHALL replace it. An HTTP error, empty body, or challenge SHALL NOT replace source facts with a successful empty observation. Existing successfully stored descriptions MAY retain the current translate-only reuse behavior; daily catalog discovery does not imply a daily refresh of every old detail description.

#### Scenario: Detail source is unchanged
- **WHEN** the source returns 304 to a validator from an earlier observation
- **THEN** extraction reuses the source-backed HTML without transferring its body again

## Verification

### Implementation anchors
- `src/features/import/adapters/enrichment/registry.ts`
- `src/features/import/core/event-enrichment.ts`
- `src/features/import/api/duplicate-detection.ts`
- `src/features/import/core/venue-settlement.ts`
- `src/trigger/jobs/daily-scrape.ts`
- `src/trigger/jobs/enrichment-catchup.ts`

### Deterministic tests
- `src/features/import/core/event-enrichment.test.ts`
- `src/features/import/api/duplicate-detection.test.ts`
- `src/features/import/core/passline-existing.test.ts`
- `src/trigger/jobs/daily-scrape-outcome.test.ts`
- `src/trigger/jobs/enrichment-catchup.test.ts`

### Verification command
```sh
bunx vitest run src/features/import/core/event-enrichment.test.ts src/features/import/api/duplicate-detection.test.ts src/features/import/core/passline-existing.test.ts src/trigger/jobs/daily-scrape-outcome.test.ts src/trigger/jobs/enrichment-catchup.test.ts
```

### Advisory conformance review
`$openspec-review-conformance event-import-enrichment` is advisory rather than proof.

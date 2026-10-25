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

#### Scenario: Source page provides no concrete activity information
- **WHEN** a source page contains only identifiers, dates, registration, ticket or boilerplate content
- **THEN** description extraction returns no description rather than a generic event paragraph or an unavailable-description notice
- **AND** it does not infer atmosphere, audience or inclusions from a title or category

#### Scenario: Source does not establish facet intensity
- **WHEN** the source does not describe energy or degree of social involvement
- **THEN** facet extraction leaves those values unknown
- **AND** missing information does not become a default low value based on an event type, genre, dinner or class

#### Scenario: Source establishes both event format and participant activity
- **WHEN** a class or workshop explicitly involves a supported participant activity
- **THEN** the multi-label facet arrays retain the supported activity alongside the format rather than replacing it with the format alone

#### Scenario: Model expresses an unknown optional facet as null
- **WHEN** an otherwise valid model facet object uses null for unknown energy or social interaction
- **THEN** the model boundary normalizes those scalars to omitted canonical values while retaining supported array facets
- **AND** invalid non-null enum values still fail validation

### Requirement: Catch-up retries are bounded per scheduled chain
The scheduled catch-up SHALL include retryable `failed` events in its first batch, then select only `pending` events in chained batches. A failed event MUST be attempted at most once per scheduled catch-up chain and remain eligible for a later scheduled run.

#### Scenario: Failed event remains retryable without looping
- **WHEN** an event selected in the first catch-up batch fails enrichment and another batch is chained
- **THEN** the next batch excludes that failed event, while the event remains eligible for the next scheduled catch-up

### Requirement: Daily discovery exhausts the source window

Daily imports SHALL acquire the full configured discovery window without deferring new events to satisfy a proxy quota.

#### Scenario: Daily discovery acquires its complete configured source window
- **WHEN** daily discovery acquires its complete configured source window
- **THEN** Passline SHALL use its published country pagination until an empty terminal page, validate every page, deduplicate identical source identities, and fail incomplete observations rather than treating a capped home feed as a complete country catalog.
- **AND** Daily enrichment chains SHALL be sized to their observed eligible set.
- **AND** Meetup date filtering SHALL include the complete last calendar day in Buenos Aires time.

#### Scenario: Passline home feed is capped
- **WHEN** more events exist than the home feed exposes
- **THEN** country pagination retains the additional eligible identities before existing CABA, date, blocklist, and unchanged-event rules apply

#### Scenario: A discovery day or page fails
- **WHEN** bounded acquisition retries cannot complete a required page or day
- **THEN** the source reports failure rather than success with an incomplete observation

### Requirement: Browser acquisition has explicit ownership and retry reuse

Production Meetup discovery SHALL use configured Cloudflare Browser Rendering, retain direct HTTP detail reads, and SHALL NOT silently fall back to a paid provider after a Cloudflare failure.

#### Scenario: A production source acquisition opens, retries, closes, or reuses a browser
- **WHEN** a production source acquisition opens, retries, closes, or reuses a browser
- **THEN** Passline SHALL retain Browserbase for challenged pages, proxy only Passline domains, block nonessential resources, and retry a failed thin detail profile once with its standard resource profile.
- **AND** Every owned browser SHALL be released and its provider closure checked.
- **AND** Successful anonymous source acquisitions SHALL be reused within the same Trigger run and across its retries, while a new daily run SHALL make fresh source observations.
- **AND** Failed acquisitions SHALL NOT be cached as success.
- **AND** A successful protected detail MAY also be reused by another same-day catch-up run after a downstream failure; its day partition SHALL reset at Buenos Aires midnight.
- **AND** Browser-consuming enrichment batches SHALL share the acquisition queue.

#### Scenario: Database or AI processing fails after a complete acquisition
- **WHEN** the same Trigger run retries with a valid retained acquisition
- **THEN** downstream processing reuses that source observation without repeating paid browser reads

### Requirement: Conditional HTTP caching preserves daily freshness
Anonymous Meetup detail HTML MAY be stored privately with validators. Each new run SHALL revalidate it; a 304 SHALL retain the previously observed source text, while a new 200 SHALL replace it. An HTTP error, empty body, or challenge SHALL NOT replace source facts with a successful empty observation. Existing successfully stored descriptions MAY retain the current translate-only reuse behavior; daily catalog discovery does not imply a daily refresh of every old detail description.

#### Scenario: Detail source is unchanged
- **WHEN** the source returns 304 to a validator from an earlier observation
- **THEN** extraction reuses the source-backed HTML without transferring its body again

### Requirement: Automated detail enrichment retains processing provenance
Successful automated full enrichment and facets backfills SHALL record the enrichment revision, configured text model, processing time and embedding model/version when an embedding is produced. Full-pass and facets-backfill records SHALL remain distinct so a facets-only write does not relabel the older description pass.

#### Scenario: Enrichment behavior changes
- **WHEN** enrichment prompts, extraction schemas or orchestration change
- **THEN** the enrichment revision is advanced

#### Scenario: A pass fails or produces unavailable output
- **WHEN** enrichment does not complete successfully
- **THEN** existing status/error fields represent the failure or unavailable output, and a successful provenance record is not fabricated

### Requirement: Detail-source age is separate from processing age
Automated detail passes SHALL distinguish body observation, HTTP revalidation and processing times. Observation SHALL mean receipt of source content, not provider publication time. Stored input without a matching receipt or legacy caches without a timestamp SHALL retain unknown age. Processing or daily catalog discovery MUST NOT imply a fresh detail read.

#### Scenario: Detail HTML is revalidated or a protected detail is reused
- **WHEN** Meetup returns 304 for retained HTML or a run retry/same-day Passline catch-up reuses a successful detail
- **THEN** the original known body observation time is retained rather than replaced with enrichment time
- **AND** HTTP revalidation time is separate from body observation time
- **AND** run retries reuse the original acquisition/revalidation receipt

#### Scenario: A facets backfill follows full enrichment
- **WHEN** an already enriched description receives a facets-only update
- **THEN** the new processing revision/time is recorded separately and the existing full-pass provenance remains unchanged
- **AND** no fresh source observation or embedding generation is claimed for a stored-input/no-embedding pass

### Requirement: Catalog imports retain acquisition and configuration receipts
The six automated catalog imports SHALL return catalog observation time, import revision and configured model/embedding identifiers in existing scrape-run metadata. Catalog receipts MUST NOT imply a refreshed detail description or a model call for every event. Import revisions SHALL advance when catalog transforms or categorization/presentation behavior changes. Unchanged events SHALL retain their no-write behavior.

#### Scenario: A catalog retry reuses a completed observation
- **WHEN** a Meetup or Passline run retry reuses a retained catalog, including an empty catalog
- **THEN** it returns the original observation time with that catalog
- **AND** a successful legacy raw-array cache may be reused with unknown observation age
- **AND** the legacy cache format remains readable by older workers

#### Scenario: A source run observes only unchanged events
- **WHEN** a daily source import completes but all event records are unchanged
- **THEN** its catalog receipt remains in the source result and finalized scrape-run metadata
- **AND** event records receive no provenance-only write or additional AI processing

### Requirement: Source monitoring preserves measured coverage and unknowns
Daily scrape metadata SHALL retain per-source catalog/filter/expansion/unchanged counts where supplied, categorization outcomes and a source-health snapshot. Monitoring SHALL distinguish failed sources, stale observations, empty catalogs, processing skips and missing measurements. Zero inserts MUST NOT imply an empty catalog or extraction failure. Enrichment failures SHALL remain separate from import success.

#### Scenario: Unchanged catalog produces no inserts
- **WHEN** the source observes events but performs no writes because they are unchanged
- **THEN** monitoring retains the fetched/filtered and available unchanged counts without an empty-catalog warning

#### Scenario: A monitoring read has incomplete history
- **WHEN** a source lacks a valid observation timestamp or a count was not measured
- **THEN** its age or count remains unknown rather than becoming fresh or zero
- **AND** the read-only health command uses a declared 36-hour daily-source freshness threshold, excludes raw provider errors/content, and reports unknown or actionable health with a nonzero exit status
- **AND** catalog counts do not claim exhaustive marketplace inventory

### Requirement: Instagram intake retains evidence before publication
Instagram collection SHALL reserve at most one paid run per Buenos Aires date, obey per-run and monthly Actor budgets, and check included account credit without upgrading or purchasing. An uncertain run start MUST be reconciled rather than retried as a new paid run. Collection SHALL retain source captions, observation revisions and bounded copies of carousel media privately, report incomplete coverage, and distinguish unchanged posts from new observations. Stories and video speech SHALL NOT be claimed as covered.

#### Scenario: The collection process stops after starting Apify
- **WHEN** the collector resumes with a retained Apify run identity
- **THEN** it resumes that run without starting another paid collection
- **AND** a reservation without a known run identity stops for reconciliation

### Requirement: Agent candidates have a shared publication boundary
The agent SHALL submit validated structured candidates with supporting observation/image references. Publication SHALL resolve a known Buenos Aires venue, preserve unknown time/price states, hold unsupported or conflicting facts, and compare the full relevant catalog date window. Exact identities MAY link sources; ambiguous matches SHALL remain held. Source discoveries SHALL be stored separately from the enabled paid watchlist.

#### Scenario: A flyer describes several occurrences or several posts promote one occurrence
- **WHEN** candidates are prepared from the observations
- **THEN** each occurrence retains its own stable candidate/event identity, and repeated promotion may attach additional evidence to the existing event

### Requirement: Intake publication is transactional and revision checked
The shared preview/commit interface SHALL persist candidate revisions, proposed actions and durable receipts. A repeated commit SHALL return its original receipt. Changed candidates, changed catalog rows, newer source observations, expired plans and held cases SHALL reject publication. A successful create or correction SHALL prepare the existing search document/embedding and description presentation before the catalog transaction.

#### Scenario: A scheduled event is canceled or rescheduled
- **WHEN** current direct organizer/venue evidence supports a correction
- **THEN** the commit updates the same catalog UUID without replacing an existing platform source identity
- **AND** subsequent legacy importer/enrichment writes cannot undo accepted facts or replace their corresponding search document
- **AND** a curator repost cannot authorize a correction

#### Scenario: Publication is retried after a successful commit
- **WHEN** the same plan is committed again
- **THEN** it returns its persisted receipt without inserting another event or repeating provider preparation

## Verification

### Implementation anchors
- `src/features/import/adapters/enrichment/registry.ts`
- `src/features/import/core/event-enrichment.ts`
- `src/features/import/api/duplicate-detection.ts`
- `src/features/import/core/venue-settlement.ts`
- `src/trigger/jobs/daily-scrape.ts`
- `src/trigger/jobs/enrichment-catchup.ts`
- `src/features/import/intake/`
- `scripts/instagram-intake.ts`
- `supabase/migrations/20261025205334_instagram_intake.sql`

### Deterministic tests
- `src/features/import/core/event-enrichment.test.ts`
- `src/features/import/api/duplicate-detection.test.ts`
- `src/features/import/core/passline-existing.test.ts`
- `src/trigger/jobs/daily-scrape-outcome.test.ts`
- `src/trigger/jobs/enrichment-catchup.test.ts`
- `src/features/import/intake/planning.test.ts`
- `src/features/import/intake/service.test.ts`
- `supabase/tests/instagram-intake.sql`

### Verification command
```sh
bunx vitest run src/features/import/core/event-enrichment.test.ts src/features/import/api/duplicate-detection.test.ts src/features/import/core/passline-existing.test.ts src/trigger/jobs/daily-scrape-outcome.test.ts src/trigger/jobs/enrichment-catchup.test.ts
```

### Advisory conformance review
`$openspec-review-conformance event-import-enrichment` is advisory rather than proof.

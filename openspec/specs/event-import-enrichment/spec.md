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

#### Scenario: Address is shared only after registration
- **WHEN** Luma's listing or detail API returns `geo_address_info.mode = 'obfuscated'` (a guests-only event)
- **THEN** the event is stored with `location_hidden = true` and no venue, and import, enrichment, and venue settlement never attach one, even when a name would match an existing venue
- **AND** when a later read shows a public address (a non-obfuscated mode with an address), `location_hidden` is cleared and the venue is settled normally; a payload missing those fields leaves the stored flag unchanged
- **AND** enrichment persists the hidden or public reading before description, translation, or embedding work, so their failure cannot leave a newly hidden event with a venue
- **AND** the database trigger `zz_hidden_location_has_no_venue` clears `venue_id` on any write that leaves `location_hidden = true`

#### Scenario: Venue name is only a place
- **WHEN** a venue name is only a city, region, or postal code (such as "Buenos Aires, Argentina", "C1437EFA, Argentina", or "CABA")
- **THEN** venue settlement and the intake `venue` operation neither match nor create a venue from it
- **AND** a venue named only after a barrio is identified by its street address: the event must carry its own numbered address, a same-name venue is reused only at the same street and number, and otherwise a new venue is created; an event without its own numbered address gets no venue, and a catalog venue's address is never evidence for another event. Barrios named after a park ("Parque Chacabuco") are not area names
- **AND** batch settlement keys every input by name plus normalized street and number, and importers send one input per event, so events in one import never share a venue by name alone

### Requirement: Venue settlement is deterministic and reviewable
Venue matching SHALL prefer valid existing identities and SHALL leave ambiguous or invalid candidates for review rather than silently attach an unrelated venue.

#### Scenario: Venue match is ambiguous
- **WHEN** no candidate satisfies the settlement rules
- **THEN** import does not claim an unsupported venue match

#### Scenario: A catalog venue's name differs only in spacing, case, accents, punctuation, or a city suffix
- **WHEN** an importer settles a venue name whose `venue_name_key` (case, accents, every kind of whitespace including non-breaking spaces, and punctuation folded; trailing "- Buenos Aires", "- CABA", "- Argentina" dropped) equals an existing venue's
- **THEN** it reuses that venue as an exact match, and `%` or `_` in a name are plain characters, never wildcards
- **AND** when several venues share that name it reuses the one at the event's own street and number; a same-name venue at another street and number is never reused, and the event gets a new venue instead
- **AND** without a numbered address on the event, or among copies with no numbered address, it reuses the copy the duplicate merge keeps (numbered address and barrio, then most events, then oldest)

#### Scenario: A venue lookup fails
- **WHEN** the same-name or similar-name lookup returns an error
- **THEN** settlement leaves the event without a venue rather than creating a possible duplicate

#### Scenario: Only a similar name exists
- **WHEN** the closest catalog name scores at least 0.85 and no numbered address on either side conflicts
- **THEN** settlement reuses that venue
- **AND** a score from 0.6 up to 0.85, or a similar name at another street and number, never attaches the event to that venue: settlement creates the venue and, for the 0.6–0.85 band, queues the lookalike in `venue_review_queue`

#### Scenario: Name similarity on D1
- **WHEN** a venue lookup runs on D1, which has no pg_trgm
- **THEN** the score is `trigramSimilarity`, which equals Postgres `similarity()` on 500 production name pairs (`src/shared/lib/search/trigram.test.ts`), and `findSimilarVenueD1` and `intakeSimilarVenuesD1` return what `find_similar_venue` and `intake_similar_venues` return

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

### Requirement: Enrichment selects each event once and skips retired sources
Enrichment SHALL move an imported `pending` event to a terminal status in the pass that processes it, so reselection and step retries do not repeat model or embedding calls. Events from the retired `passline`, `eventbrite`, and `venti` sources SHALL be excluded from enrichment selection and counts without changing or deleting them.

#### Scenario: An imported event with an embedding and a Spanish description is enriched
- **WHEN** a batch enriches it and a later batch or a retried step reselects pending events
- **THEN** it is written `completed` once and is not selected again

#### Scenario: The English translation of a Spanish-only event fails
- **WHEN** translation returns no text for an event that needs it
- **THEN** the event keeps its Spanish description, is marked `failed` with a translation error rather than `completed`, and the next scheduled catch-up retries it

#### Scenario: A retired source still has pending or failed events
- **WHEN** the daily chain or catch-up selects or counts events needing enrichment
- **THEN** those events are excluded and keep their stored values

### Requirement: The catalog runs on D1 and Vectorize behind the backend seam
Imports, venue settlement, the venue review queue, enrichment, the blocklist, and the daily-scrape audit SHALL read and write the catalog through one repository that requires `DB` and `VECTORIZE`. Every event write that carries a new embedding SHALL upsert the vector with the event id and `{ status, starts_at }` metadata (epoch ms), and a write that changes `status` or `starts_at` SHALL rewrite that metadata. A vector MUST NOT change when intake protection reverts the event's search document. Hourly, scheduled and pending-review events SHALL become `past` by the 4-hour and 28-hour rule, and nightly the vectors of live and recently changed events SHALL be reconciled with D1; both run only when `DB` is bound.

#### Scenario: A jobs Worker without a D1 binding
- **WHEN** the jobs Worker runs without `DB`
- **THEN** catalog jobs cannot run and no writes are sent to another backend

#### Scenario: An event is imported on D1
- **WHEN** an importer inserts or re-embeds an event
- **THEN** the event row and its vector are written, and the vector's metadata matches the row's status and start

#### Scenario: An event passes its end
- **WHEN** the hourly task finds a scheduled event that ended, a timed event that started more than 4 hours ago, or a date-only event that started more than 28 hours ago
- **THEN** the event becomes `past` and its vector's status follows

#### Scenario: Vectorize drifts from D1
- **WHEN** the nightly reconcile finds a stale search document, a live event without a vector, or vector metadata that differs from the row
- **THEN** it re-embeds the document, restores the vector, or rewrites the metadata, within a bounded number of embedding calls per night

### Requirement: Catch-up retries are bounded per scheduled chain
The scheduled catch-up SHALL include retryable `failed` events in its first batch, then select only `pending` events in chained batches. A failed event MUST be attempted at most once per scheduled catch-up chain and remain eligible for a later scheduled run.

#### Scenario: Failed event remains retryable without looping
- **WHEN** an event selected in the first catch-up batch fails enrichment and another batch is chained
- **THEN** the next batch excludes that failed event, while the event remains eligible for the next scheduled catch-up

### Requirement: Daily discovery exhausts the source window

Daily imports SHALL acquire the full configured discovery window without deferring new events to satisfy a proxy quota.

#### Scenario: Daily discovery acquires its complete configured source window
- **WHEN** daily discovery acquires its complete configured source window
- **THEN** the daily run SHALL import Meetup, BA Tourism, and Luma, each as its own retried Workflow step, concurrently and without an overall instance deadline, so a source that fails or times out on every attempt does not prevent the others or finalization from running.
- **AND** Daily enrichment chains SHALL be sized to their observed eligible set.
- **AND** Meetup date filtering SHALL include the complete last calendar day in Buenos Aires time.

#### Scenario: A source rate-limits the jobs Worker
- **WHEN** a source answers 429
- **THEN** its step waits for `Retry-After`, or minutes when absent, before retrying within its time budget, rather than spending its attempts within seconds
- **AND** other errors keep the short exponential backoff

#### Scenario: A discovery day or page fails
- **WHEN** bounded acquisition retries cannot complete a required page or day
- **THEN** the source reports failure rather than success with an incomplete observation

### Requirement: Browser acquisition has explicit ownership and retry reuse

Production Meetup and BA Tourism discovery SHALL use Cloudflare Browser Rendering through the jobs Worker's browser binding, Meetup SHALL retain direct HTTP detail reads, and a Browser Rendering failure SHALL fail the source step rather than fall back to another provider.

#### Scenario: A production source acquisition opens, retries, closes, or reuses a browser
- **WHEN** a production source acquisition opens, retries, closes, or reuses a browser
- **THEN** Every owned browser SHALL be released when its acquisition run ends.
- **AND** Successful anonymous source acquisitions SHALL be reused within the same Workflow run and across its step retries, while a new daily run SHALL make fresh source observations.
- **AND** Failed acquisitions SHALL NOT be cached as success.
- **AND** A successful protected detail MAY also be reused by another same-day catch-up run after a downstream failure; its day partition SHALL reset at Buenos Aires midnight.

#### Scenario: Database or AI processing fails after a complete acquisition
- **WHEN** the same Workflow step retries with a valid retained acquisition
- **THEN** downstream processing reuses that source observation without repeating paid browser reads

#### Scenario: Browser release cannot be confirmed
- **WHEN** concurrent cleanup requests target the same owned browser
- **THEN** they share one in-flight release and verification attempt
- **AND** a confirmed release is not repeated, while a later cleanup may retry an unconfirmed release
- **AND** a failed verification is not retained as permanent proof of closure

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
- **WHEN** Meetup returns 304 for retained HTML or a run retry/same-day catch-up reuses a successful detail
- **THEN** the original known body observation time is retained rather than replaced with enrichment time
- **AND** HTTP revalidation time is separate from body observation time
- **AND** run retries reuse the original acquisition/revalidation receipt

#### Scenario: A facets backfill follows full enrichment
- **WHEN** an already enriched description receives a facets-only update
- **THEN** the new processing revision/time is recorded separately and the existing full-pass provenance remains unchanged
- **AND** no fresh source observation or embedding generation is claimed for a stored-input/no-embedding pass

### Requirement: Catalog imports retain acquisition and configuration receipts
The three automated catalog imports SHALL return catalog observation time, import revision and configured model/embedding identifiers in existing scrape-run metadata. Catalog receipts MUST NOT imply a refreshed detail description or a model call for every event. Import revisions SHALL advance when catalog transforms or categorization/presentation behavior changes. Unchanged events SHALL retain their no-write behavior.

#### Scenario: A catalog retry reuses a completed observation
- **WHEN** a Meetup run retry reuses a retained catalog, including an empty catalog
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
Instagram collection SHALL reserve at most one paid run per Buenos Aires date, obey per-run and monthly Actor budgets, and start a paid run only when the Apify account's monthly usage limit minus the cycle's usage covers the run cap, without upgrading, purchasing or raising that limit. An uncertain run start MUST be reconciled rather than retried as a new paid run. Collection SHALL retain source captions, observation revisions and bounded copies of carousel media privately, report incomplete coverage, and distinguish unchanged posts from new observations. Stories and video speech SHALL NOT be claimed as covered.
Each run SHALL request only posts newer than 2 hours before the latest successful run was reserved, as a precise UTC timestamp so each post is billed about once, or 7 days when no run has succeeded, reaching back at most 30 days, with a per-account ceiling from policy. Re-observed unchanged posts SHALL NOT create new observations. Per-account error rows SHALL NOT create observations; accounts that were not found, restricted, errored, at the ceiling or not reached before the run stopped SHALL be named in the run summary.

#### Scenario: A daily run overlaps the previous successful run
- **WHEN** a post collected yesterday is returned again in today's 2-hour overlap margin
- **THEN** its existing observation is marked seen and no new observation is created

#### Scenario: Apify returns error rows or stops at the run cap
- **WHEN** the dataset contains `no_items`, `not_found` or restricted rows, or omits some requested accounts
- **THEN** collection succeeds without observations for those rows and the summary names each affected account

#### Scenario: An image failed to save on an earlier run
- **WHEN** an unreviewed observation is missing an image position and its post is not in today's dataset
- **THEN** each collect, including a resumed or repeated one, retries that position from the observation's stored URL, at most a bounded number of downloads per run, without refetching saved positions
- **AND** the run summary lists, by observation and position, today's first-attempt failures, positions that failed again on this retry, positions skipped because their stored URL's signed expiry has passed, and positions deferred by the cap
- **AND** a failed read or write in the retry, or its overall deadline, ends only the retry: collection still returns its summary with the retry's error named

#### Scenario: The collection process stops after starting Apify
- **WHEN** the collector resumes with a retained Apify run identity
- **THEN** it resumes that run without starting another paid collection
- **AND** a reservation without a known run identity stops for reconciliation

### Requirement: Agent candidates have a shared publication boundary
The agent SHALL submit validated structured candidates with supporting observation/image references. Publication SHALL resolve a known Buenos Aires venue, preserve unknown time/price states, hold unsupported or conflicting facts, and compare the full relevant catalog date window. Exact identities MAY link sources; ambiguous matches SHALL remain held. Source discoveries SHALL be stored separately from the enabled paid watchlist.

#### Scenario: A date, time or address appears only on an official page
- **WHEN** a candidate cites `{ kind: 'official_page', url, excerpt }` evidence for a field the post doesn't state
- **THEN** preview and commit each fetch the URL themselves (public HTTPS hosts only, no cookies, bounded size and time) and accept it only when the page's visible text contains the excerpt after whitespace-, case- and accent-insensitive normalization
- **AND** on El Camarín de las Musas's Fanz event page with an explicit `eventDateId`, date and time evidence must quote the selected same-day performance's date-picker line and match its own event title, full local date, and start time; ordinary page text cannot substitute for that line, and a performance that has already started does not produce one
- **AND** a scheme-less `www.` domain in a cited caption counts as a linked site even with trailing sentence punctuation; an unmentioned domain does not
- **AND** a redirect to a Queue-it waiting room is not fetched and tells the operator to cite another official page
- **AND** the candidate still needs at least one Instagram observation, caption evidence still requires an exact excerpt, and a correction of an existing event still needs the organizer's or venue's own post

#### Scenario: A flyer describes several occurrences or several posts promote one occurrence
- **WHEN** candidates are prepared from the observations
- **THEN** each occurrence retains its own stable candidate/event identity, and repeated promotion may attach additional evidence to the existing event

#### Scenario: A held candidate's venue is not in the catalog
- **WHEN** the operator submits a sourced venue name, street address with a house number after the street name, optional barrio and evidence URLs to the intake `venue` operation
- **THEN** exactly one venue with the same normalized name and no conflicting address or barrio returns that venue, and several same-name venues, a conflicting location, a similar name, a possible alias, or another venue at the same address returns `ambiguous` without writing anything
- **AND** a similar-name or alias candidate no longer blocks creation once the operator lists it in `distinct_from` with a reason, which is kept with the evidence; a same-name or same-address candidate always blocks
- **AND** otherwise a venue is created only inside the city of Buenos Aires with a valid barrio, its evidence is kept as an approved `instagram-intake` row in `venue_review_queue`, and repeating the request returns the same venue
- **AND** before creating, completing, or correcting a venue, Nominatim or USIG confirms the exact CABA street type, name, and house number; failures or lack of an exact match never authorize a write
- **AND** an exact Provincia match holds unless the address or evidence explicitly identifies CABA or a CABA barrio and USIG independently confirms a single matching CABA street, without overriding any supplied non-CABA locality; conflicting USIG street matches or a conflicting stated barrio return `ambiguous` without writing
- **AND** the `held` operation lists unpublished future candidates grouped by venue with their hold reasons

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

### Requirement: The intake API is the D1 backend for the operator CLI
Where the jobs Worker binds the D1 database, `/intake/*` on that Worker SHALL serve every intake operation, behind a bearer `INTAKE_API_TOKEN` of at least 32 characters compared in constant time, and SHALL decode every request body strictly, refusing unknown fields. Without the D1 binding every `/intake/*` path SHALL answer 404. The operator CLI SHALL require both `INTAKE_API_URL` and `INTAKE_API_TOKEN` for every command except help, keep its commands and output shapes, and keep Apify calls and image downloads on the operator's machine. Evidence images SHALL be stored privately in R2 under their sha256 key after the server checks their type, size and hash; published artwork SHALL be copied to the artwork bucket and named by the site's artwork route. On D1 the candidate submission, plan check, commit and collection reservation SHALL each run as one transaction with the Postgres functions' rules and messages, and a commit SHALL set `write_context` so intake protection lets it change protected facts. `/intake/sources` SHALL insert new Instagram sources disabled and leave every existing username unchanged. While `DB_READ_ONLY` is `1` the API SHALL serve only operations that never write and answer 503 to the rest, and the jobs crons SHALL start nothing.

#### Scenario: A request lacks the token
- **WHEN** a request to `/intake/*` has no bearer token or the wrong one
- **THEN** it is refused with 401 and nothing is read or written

#### Scenario: A jobs Worker without D1
- **WHEN** `baeventos-jobs` has no D1 binding
- **THEN** every `/intake/*` request answers 404 and a CLI operation reports missing configuration or fails if the API is unavailable

#### Scenario: Writes are frozen for the cutover
- **WHEN** `DB_READ_ONLY` is `1` and the operator calls `preflight`, then `source`
- **THEN** `preflight` answers as usual and `source` answers 503 without writing

#### Scenario: A committed plan's vector upsert failed
- **WHEN** the D1 commit succeeded but the Vectorize upsert did not
- **THEN** committing the same plan again returns the same receipt and upserts the event's vector

### Requirement: Bounded manual embedding repair

The operator MUST explicitly select staging or production. Both manual commands MUST submit the catalog Workflow and report the instance ID, not claim that writes succeeded. The Workflow MUST reject writes in read-only mode, process at most the requested 1–200 events, and report blocked rows and whether work remains. It MUST NOT change the nightly reconciliation schedule or scope.

#### Scenario: A missing vector
- **WHEN** `populate-embeddings` finds an event ID absent from Vectorize, regardless of event status
- **THEN** it restores a vector that matches the stored search document, or builds and stores a document with its version first if none exists

#### Scenario: A stale scheduled event
- **WHEN** `reembed-stale` finds a scheduled event with an old version or no search document
- **THEN** it processes it in `(starts_at, id)` order, checks the stored document and version after triggers, and updates the vector only when the new document was kept
- **AND** a failed Vectorize write after the D1 commit stays queued for retry

## Verification

### Implementation anchors
- `src/features/import/adapters/enrichment/registry.ts`
- `src/features/import/core/event-enrichment.ts`
- `src/features/import/api/duplicate-detection.ts`
- `src/features/import/core/venue-settlement.ts`
- `src/jobs-worker/index.ts`
- `src/jobs-worker/daily-scrape.ts`
- `src/jobs-worker/enrichment.ts`
- `src/features/import/intake/`
- `scripts/instagram-intake.ts`
- `src/features/import/intake/venues.ts`
- `src/features/import/intake/store-d1.ts`
- `src/features/import/intake/client.ts`
- `src/jobs-worker/intake-api.ts`
- `src/features/import/core/venue-identity.ts`
- `src/features/import/scrapers/venue-matcher.ts`
- `src/features/import/scrapers/luma/location.ts`
- `src/features/import/core/catalog-store.ts`, `catalog-store-d1.ts`, and `catalog-store-for.ts`
- `src/jobs-worker/catalog-maintenance.ts`

### Deterministic tests
- `src/features/import/core/event-enrichment.test.ts`
- `src/features/import/core/venue-identity.test.ts`
- `src/features/import/core/venue-settlement.test.ts`
- `src/features/import/core/venue-duplicates.test.ts`
- `src/features/import/api/duplicate-detection.test.ts`
- `src/features/import/core/catalog-store-d1.test.ts` and `importers-d1.test.ts` (Miniflare D1)
- `src/jobs-worker/catalog-maintenance.test.ts` (Miniflare D1)
- `src/jobs-worker/daily-scrape-outcome.test.ts`
- `src/jobs-worker/enrichment.test.ts`
- `src/features/import/acquisition/run.test.ts`
- `src/features/import/intake/planning.test.ts`
- `src/features/import/intake/service.test.ts`
- `src/features/import/intake/collection.test.ts`
- `src/features/import/intake/venues.test.ts`
- `src/features/import/intake/store-d1.test.ts`
- `src/jobs-worker/intake-api.test.ts`
- `src/features/import/scrapers/luma/http.test.ts`
- `src/features/import/adapters/enrichment/luma-enrichment.test.ts`
- `src/features/import/core/venue-settlement.test.ts`

### Verification command
```sh
bunx vitest run src/features/import/core/event-enrichment.test.ts src/features/import/api/duplicate-detection.test.ts src/jobs-worker/daily-scrape-outcome.test.ts src/jobs-worker/enrichment.test.ts src/features/import/acquisition/run.test.ts
```

### Advisory conformance review
`$openspec-review-conformance event-import-enrichment` is advisory rather than proof.

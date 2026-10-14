# Applied AI engineering work

This checklist tracks the remaining applied AI engineering work for BA Eventos
and Casamo. Checked items have recorded verification; local completion and
production release are separate. Update this file at each completion checkpoint.

Execution order: work through sections 1–12 in order, taking unchecked items
from top to bottom within each section. For shared items, handle BA Eventos
first, then Casamo. Complete only the prerequisites needed for the current item;
do not select later work based on an informal priority judgment. If an item
requires external input, record the dependency and leave it unchecked, then
continue to the next item. Return to waiting items when the dependency clears.
Check an item only after its stated scope has verification evidence.

Scale constraint (user reminder): prefer the existing tests, thin Langfuse
adapters and small repeatable suites. Do not add more custom review infrastructure
or pursue exhaustive corpus coverage as a prerequisite for routine fixes. Keep
independent-label dependencies visible, use focused checks for each change, and
reserve full release gates for release checkpoints. Broader provider coverage
remains recorded below as deferred work, rather than being marked complete.

Current focus: Section 11 — local Section 9 cancellation/failure exercises are complete;
Section 10 has provisional targets and measurements, with budget/review decisions open.
Section 8 release prerequisites remain open: BA draft PR #6 and Casamo draft PR #5 are prepared
and their release checks pass. Both production Workers have project-specific
Langfuse settings; the tracing code remains undeployed. BA’s migrations await
Supabase sign-in. Casamo’s staging scan verification awaits a separate Langfuse
staging key; the existing read-only canary verifies the Access boundary only.
Saved production-error views and existing curated views are recorded below.
Alerts await an existing notification destination. Prompt/request-configuration
identifiers are implemented and locally verified in both release branches.
Continue Section 11’s telemetry/replay privacy and limiter-outage protection while
deployment, budget and reviewer dependencies remain open. Casamo’s photo label conflict and failed gate remain
unchanged pending independent review.

Earlier engineering work and its receipts are recorded under each section.
Real-user satisfaction and independent human labels remain external dependencies;
leave their boxes open and return when observations arrive. Supplementary
current-version Booking coverage remains deferred for our scale. Casamo trip
Q&A is removed locally; its release and deletion migration remain in Section 12.

## 1. Product outcomes

- [x] Define task success and failure categories for recommendations and follow-ups.
- [ ] Collect satisfaction alongside clicks, saves, and conversion.
  - [x] Implement BA Eventos web reply helpfulness, offer/rating coverage, and response-linked engagement (local verification).
  - [x] Implement corresponding Casamo scan-result satisfaction collection and engagement correlation (local verification).
  - [ ] Release collection and verify real-user BA Eventos/Casamo cohorts; report observed actions separately from unobserved purchases/attendance.
    - [x] Prepare and verify an isolated BA Eventos feedback release against current main (PR #5).
    - [x] Merge and verify BA Eventos production collection and recovery behavior.
    - [x] Prepare and verify an isolated Casamo feedback release, including the required staging check for analytics integration (PR #3).
    - [x] Release and verify Casamo production collection, including the SDK-startup fix and explicit browser-blocking limits.
    - [x] Inspect declared real-user reporting cohorts in both projects; keep absent ratings unknown.
    - [ ] Revisit satisfaction and engagement reporting when non-canary user observations arrive (external dependency; initial cohorts are empty).
- [x] Define corresponding success measures for Casamo scan decisions, with explicit denominators and failure categories.

## 2. Agent architecture

- [ ] Establish the quality baseline before adding agents, tools, or model stages.
  - [x] Inventory the existing BA Eventos and Casamo evidence, verify available report/fixture fingerprints, and record its scope and gaps in `docs/agent-architecture-baseline.md`.
  - [x] Refresh BA Eventos' repeated conversation-contract baseline against current orchestration with the unchanged corpus and graders (24 trials/72 turns; 23/24 automatic passes, one documented language-check false positive).
  - [x] Correct the locale grader's short-Spanish false positive, validate its bilingual scope on a separate 200-sentence PUD holdout, and retain the original score/report (v2 rescore 24/24; no new model calls).
  - [ ] Complete independent BA Eventos prose labels and verify calibration/coverage (external reviewer dependency; existing blinded packet prepared).
  - [x] Verify Casamo's existing narrow review-audit receipt and rerun its production assessment/replay contract checks; retain the distinction from whole-scan quality.
  - [ ] Prepare source-preserving Casamo whole-scan holdouts and a blinded review packet.
    - [x] Implement the frozen-input importer, scoped source/media checks, blinded offline packet and strict independent-label comparison.
    - [x] Freeze the first captured production scan: 42 unit assessments and 218 fingerprint-verified original artifacts, with missing media explicit.
    - [ ] Expand the frozen cohort across providers, source modes, source languages and positive/negative/unknown classes; one all-negative destination scan is insufficient coverage.
      - [x] Expand available captured coverage to four scans/125 unit assessments/117 distinct properties, both source modes, mixed English/Spanish review evidence, and 31 eligible/92 ruled-out/two unverified predictions.
      - [x] Support historical Booking assessment reads with original producer versions preserved and historical/current prediction origins separated.
      - [ ] Obtain current-version Booking captures and frozen visual inputs for fresh audit comparisons; historical image bytes were not retained.
        - [x] Freeze fresh Airbnb visual inputs (34 entries/33 unique images) with byte hashes, timestamps, scoped source galleries and bounded CDN reads; preserve the historical image gap.
        - [x] Run fresh native photo audits on those exact bytes, retaining delivery/protocol receipts and a blinded human-label packet (three galleries, nine model requests, 34 completed observations; quality ungraded).
        - [ ] Add corresponding current-version Booking inputs and whole-scan fresh audit comparisons; retain policy/source mode and original/new observation dates (deferred supplementary coverage under the scale constraint; no additional review tooling planned).
    - [x] Add captured coordinator/discovery/selection/publication receipts alongside property replay; saved primary unit identities match captured selection in the added cases. Full operational re-execution is not claimed.
  - [ ] Obtain independent Casamo decision labels and establish the whole-scan baseline (external reviewer dependency after holdout preparation).
- [ ] Verify essential authority and execution limits against that baseline.
  - [x] Verify BA Eventos' declared read-only tool set, sequential/parallel eight-call cap, reference provenance and local cancellation boundaries; add direct excess-call regression tests.
  - [x] Verify Casamo's declared/scoped actions, shared/per-scan capacity, retry/lease/cutoff and stale-publication boundaries through native and Cloudflare runtime tests.
  - [ ] Assess the limits against the completed reviewed quality baselines; retain deployed cancellation/recovery verification under section 9.

## 3. Tool contracts and factual grounding

- [x] Apply canonical card provenance and read-only checks to every concierge case.
- [ ] Grade model prose against the exact supplied evidence, separately from card provenance.
  - [x] Implement and run separate provisional prose grading on captured model-visible evidence; the retained report has 68 graded turns and four errors.
  - [ ] Calibrate against independent labels (same reviewer dependency as Section 2); automatic judgments remain uncalibrated.
- [ ] Measure event existence, suitability, and explanation accuracy independently.
  - [x] Record separate dimension coverage, scores, non-applicable cases and errors in the existing quality report.
  - [ ] Establish trustworthy baseline rates after independent review; card provenance alone does not establish real-world event existence.
- [x] Verify critical facts consistently use authoritative presentation fields (local deterministic contract checks; generated-prose calibration and deployment remain separate).
  - [x] Remove unverified start/end times from time-TBA model inputs while retaining the known Buenos Aires date and existing canonical card data (local orchestration regression coverage).
  - [x] Check BA hidden locations, prices, source links and missing-description presentation across concierge reads; close stored-address and zero-price formatter gaps (local verification).
  - [x] Check Casamo's corresponding scoped source facts and unavailable-evidence presentation using existing evidence, qualification and customer-presentation tests.
- [x] Prevent empty-result retries from dropping free-only or neighborhood constraints.

## 4. Prompt and context management

- [x] Remove duplicated instructions using before/after evaluations where a meaningful duplicate layer exists.
  - [x] Consolidate repeated BA search/detail/directions routing instructions in the main prompt; shorten three tool descriptions and compare two bilingual conversations with two trials each before/after.
  - [x] Review Casamo's photo/review instructions for meaningful duplication; retain distinct selection/detection/verification guidance and compatible legacy revisions without a speculative rewrite or paid comparison.
- [x] Establish per-request aggregate context budgets and measure BA history truncation failures (local checks; observed token guards do not prevent initial overshoot).
  - [x] Add BA's 6,000-character aggregate history cap and 16,000-token observed per-request guard; measure actual bilingual follow-ups with oversized old dialogue.
  - [x] Establish Casamo's aggregate review/photo prompt budget at the shared client: 64 KiB of complete system/schema/source text and 32,768 provider-reported input tokens, with non-retryable unavailable outcomes and unchanged evidence. Trip Q&A remains removed; there is no conversational history to truncate.
- [x] Reduce overlapping tool descriptions and preserve source/detail access without a speculative excerpt-retrieval layer.
  - [x] Shorten overlapping BA tool descriptions through the recorded before/after comparison.
  - [x] Remove BA's redundant rendered/summary copies from model reads when complete originals exist; retain the richer available fallback for presentation-only records and all canonical card data. Full original source text remains available through the existing reads.
  - [x] Confirm Casamo's conditional acquisition/detail stages follow applicable requirements and mandatory review/verification obligations; reuse existing implementation.

## 5. Source data and AI enrichment

- [x] Add labeled translation, summary, facet, venue, and missing-information evaluations (developer controls and local contracts; failures retained, independent quality calibration still pending).
  - [x] Add twelve bilingual BA developer-labeled source controls using production helpers, explicit live invocation, actual-input/protocol checks and retained failure reports.
  - [x] Return no description for activity-free source pages; leave unsupported facet intensity unknown; normalize model null intensity without discarding known facets or changing canonical persisted values.
  - [x] Review the tango activity diagnostic against the fresh bilingual retrieval capture: both queries preserve tango/dancing preferences, but head candidates include a salsa class with a tango tag and performances/tours rather than verified beginner-class matches. The earlier 2/3 control result remains unchanged; source-grounded relevance grades and remediation remain under Section 6, without further prompt tuning to make the control green.
  - [x] Cover Casamo's applicable translation, evidence-summary, provider-fact, identity and missing-source transformations using existing fixtures/production boundaries; fix blank-title fallback and cache poisoning (local contract coverage, not independent model-quality calibration).
- [x] Record source observation and enrichment versions consistently (local implementation/contract verification; production releases remain under Section 8).
  - [x] Record BA automated detail/full enrichment and facets-backfill provenance, with separate observation/revalidation/processing times, configured model IDs and a manually advanced enrichment revision (local verification: 30 focused Vitest tests, including a final 16-test core rerun; seven native acquisition tests; TypeScript and 10/10 specs without warnings).
  - [x] Cover all six automated BA catalog imports with observation, import revision and configured model/embedding identifiers in existing scrape-run metadata; retain retry/empty/legacy observations and unchanged-event no-write behavior. These receipts describe catalog reads/configuration, not a refreshed detail or per-event model-call proof (local verification: 50 focused catalog/import tests plus the final nine-test acquisition check in Vitest and Bun; TypeScript and 10/10 specs without warnings). Acquisition unit tests use memory and cannot reach the durable cache through local credentials.
  - [x] Verify Casamo's existing immutable provider capture dates, normalized fact/source references, accepted parser/model/prompt/schema manifest, actual prompt/schema hashes and separately timed action/model receipts. Compatible reuse retains original artifacts; unsupported replay revisions fail closed (54 focused native checks; no live model/provider calls or new storage). Scan manifest reference time, action output time and provider capture time have different meanings. Existing title-translation cache rows identify exact source text/hash and cache insertion time; original translation generation/model history remains unknown rather than being inferred from report processing time.
- [x] Monitor source freshness, completeness, and extraction failures (local operational tooling; deployment and alert configuration remain in Section 8).
  - [x] Add BA's existing-record health snapshot/warnings and read-only `source:health` command, with a declared 36-hour freshness threshold, actual per-source counts, unknown legacy measurements and separate inventory/daily-enrichment outcomes (27 focused Vitest tests, four native health tests, TypeScript and 10/10 specs without warnings; first production read retained privately).
  - [x] Verify Casamo's existing scan profiler, scoped source/reuse contracts and gallery/review coverage/failure records; retain bounded stop-reason/strategy labels and fix unavailable provider-query totals being presented as zero (19 focused native checks, final eight-test collector rerun, standalone collector TypeScript and strict 18/18 OpenSpec validation). Original capture/fact dates establish source observation age; attempt/artifact/report dates do not. Diagnostic samples and attempt totals are not exhaustive provider inventory. No new service, table, source/model call or alerting system was added.
  - Production diagnostic: the `2026-10-14T02:39:10.170Z` BA read reports the latest daily run partial (Luma failed), 1,457 upcoming scheduled events, 25 with both primary descriptions null and one failed enrichment. The latest daily chain separately completed 64/64. These are observed data-health signals, not a clean-production claim; confirm source recovery and new source-count/age receipts at the Section 8 release checkpoint.

## 6. Retrieval and ranking

- [ ] Refresh representative English/Spanish retrieval holdouts.
  - [x] Declare BA's six bilingual query pairs, separate ten holdouts from two known tango diagnostics, and capture current production-helper retrieval inputs/candidates without altering historical artifacts (12/12 queries, 251 distinct frozen records, 81 ungraded options via existing review tools; exact filters/query fingerprint/completion retained; TypeScript and live capture pass).
  - [ ] Obtain source-grounded independent grades for the refreshed BA packet (external reviewer dependency); pooled candidates are not an exhaustive recall denominator. Preserve the salsa-as-tango tag and concert/tour head-candidate diagnostics rather than claim a verified beginner-class match.
  - [x] Map Casamo's existing four-scan/125-unit cohort to bilingual source/discovery and scoped candidate coverage, reverify all bundle/recorded-decision hashes and preserve provider-specific parser/audit revisions in the private retrieval coverage index (63 focused native discovery/long-stay/listing checks; no source/model calls or fixture changes). Both source modes and English/Spanish review metadata are present; labels remain independent/unfilled, and current-policy Booking expansion stays deferred under Section 2.
- [ ] Measure candidate recall, ranking, empty results, and inventory coverage separately.
  - [x] Record BA candidate counts/cap hits, distinct retrieved records, raw empty-query rate and time-separated hard-filter inventory sizes; keep candidate recall, ranked quality and a full relevant-inventory denominator null rather than deriving them from the returned pool (12 queries; 396 candidate observations; 251 records; zero empty lists; means 31 English/35 Spanish; six cap hits).
  - [x] Remove BA's unrequested hard electronic-genre exclusion from live music and preserve explicit exclusions, with bilingual regression cases and a two-case capture under the original clock (120 focused intent/search tests, TypeScript and 10/10 specs; six/seven candidates after versus five/six before; no hosted reranker call or quality-improvement claim).
  - [x] Record Casamo acquired unit/property counts and predicted classes separately from the two available captured selection/publication receipts; preserve missing independent quality and exhaustive inventory denominators as null.
  - [x] Fix paid-only filtering at both layers: preserve explicit false in semantic/lexical serialized requests, and prepare current-signature SQL functions whose free-status predicates accept false (nine focused checks in Vitest and Bun; actual disposable PostgreSQL/pgvector reproduces the old zero-paid-match behavior and passes all six paid/free/unrestricted cases plus migration reapplication). SQL application/deployed verification remain under Section 8. Temporary test-engine packages are isolated in ignored results, with no project dependency addition.
  - [ ] Establish candidate-recall and ranking-quality rates after independent source-grounded grading and an appropriate relevant-set denominator (external review dependency; returned-pool grades alone cannot prove inventory-wide recall).
- [ ] Reassess reranking choices against the refreshed evidence.
  - Waiting for source-grounded independent relevance/decision grades; candidate counts and ungraded captures do not justify a ranking change. Preserve the existing strategy until that dependency clears.

## 7. Evaluations

- [x] Use production turn preparation, authoritative rehydration, and correct model-step accounting.
- [x] Add the BA Eventos thin Langfuse experiment adapter while retaining existing tests.
- [x] Add actual multi-turn clarification, refinement, ordinal, and directions cases.
- [x] Add independent repeated trials and report variability and conversation success.
- [x] Freeze the event corpus and clock, and record their version and fingerprint.
- [ ] Establish the full bilingual factuality/usefulness baseline with human-calibrated graders.
- [x] Connect Casamo photo/review audit evaluations to Langfuse.
  - First cloud runs verified all six review items and four photo-gallery items (33 photos), including nested model observations and exact scores. Credentials are private and project-specific; existing fixtures/tests and the thin adapter are retained. Review safety passed; photo safety failed with one false positive, six misses and no scope mismatches. No repeat run was made.
  - [x] Review the recorded photo false positive: case airbnb-861537024367998674-007 labels a chair at a desk false, while current canonical policy and the high-detail prompt accept a usable backed dining chair at a desk. A current source-image inspection and the existing workspace regression support a label conflict; original-run byte equality is unavailable. Preserve the fixture, six misses and failed gate; independent label reconciliation remains under the human-calibrated baseline above.

## 8. Observability and feedback

- [x] Create separate BA Eventos and Casamo projects under HC Studio.
- [x] Implement BA Eventos model/tool tracing and verify export in a Workers runtime.
- [ ] Deploy BA Eventos tracing and verify real web/Telegram sessions.
  - [x] Prepare isolated draft PR #6 on current main; 813 Bun/798 Vitest tests, Svelte/TypeScript checks, 10 specs and the production build pass. Preserve deployed chat recovery/feedback and exclude private diagnostics.
  - [x] Configure BA’s project-specific Langfuse keys, US base URL and production environment on the application Worker; code deployment/real traces remain pending.
  - [ ] Apply the prepared migrations before merging; Supabase browser sign-in is required because local database-management credentials are absent.
  - [ ] Apply BA's additive `20261014000000_add_enrichment_provenance.sql` migration and release/verify the import/enrichment pipeline with tracing; older rows remain unknown, with no speculative backfill.
  - [ ] Apply `20261014010000_fix_paid_only_search_filters.sql` before the changed search client, and verify paid/free/unrestricted searches through the deployed functions.
- [x] Instrument Casamo scan/model audit execution locally with optional, metadata-only tracing.
- [ ] Configure Casamo project keys and verify cloud traces, staging scans and production execution.
  - [x] Save the project key in ignored local .env and verify review/photo experiment traces and scores in Casamo Cloud.
  - [x] Prepare isolated Casamo draft PR #5 (https://github.com/HanifCarroll/casamo/pull/5) for metadata-only tracing and the existing eval adapter; full native release gate, build and staging scan Worker packaging pass. Existing Q&A/context-budget changes remain separate pending releases.
  - [x] Configure project-specific Langfuse credentials, US base URL and production environment on Casamo’s private scan Worker.
  - [ ] Configure a separate staging Langfuse key and obtain authenticated staging canary access; existing unauthenticated staging check confirms the Access login redirect only.
  - [ ] Verify staging scan/action cloud traces, release production code and verify production execution.
- [ ] Configure quality, latency, fallback, errors, usage, and cost views and alerts.
  - [x] Reuse the existing Langfuse Home, Agent, Latency, Cost and Usage dashboards in both projects; save and reopen a project-specific production-error widget in each (production + ERROR + GENERATION). No dashboard framework, runtime code or model reruns were added.
  - [ ] Link an existing notification automation and save one production model-error alert per project (count > 0 over one hour, missing data NO_DATA, renotify off). BA’s prepared form cannot save without an automation; no alerts or notification integration have been created. Destination is an external input dependency.
  - [ ] Verify deployed metric coverage, fallback measurement and cost/model-price mappings; empty production views do not establish healthy traffic, measured quality or total provider spending. Keep human-calibrated quality rates under Section 7.
- [ ] Attach prompt/configuration identifiers and promote reviewed failures into regression cases.
  - [x] Add BA’s explicit prompt revision and a fingerprint of selected model/provider, contract, supplied tools, limits, retries and thinking options. A real-SDK local export probe verifies stable identity across different messages and changed identity across selected models; no external model calls. Thirty focused orchestration/cancellation checks, TypeScript and 10 specs pass.
  - [x] Add Casamo’s declared request-configuration fingerprint alongside existing prompt/schema revisions and available hashes. Real Workers SDK export, metadata-only exclusion checks, nine native tracing/SDK checks, Worker TypeScript and strict 18-item validation pass.
  - [x] Retain reviewed deterministic failures as regression cases: BA paid-only serialization, bilingual live-music exclusions, nullable enrichment output and grounding/cancellation cases already have direct checks. Do not relabel Casamo’s disputed photo fixture or unreviewed prose as accepted regressions.
  - [ ] Verify identifiers on deployed traces and promote independently reviewed quality failures after labels arrive.

## 9. Reliability and recovery

- [ ] Verify deployed interruption, cancellation, replay, and recovery behavior.
- [x] Propagate BA concierge cancellation through model, history, context and read-tool requests (local verification).
- [x] Verify local cancellation of BA channel requests and Casamo model/provider operations.
  - [x] Reject already-cancelled and late-completing BA event/venue/directions reads before returning facts or starting a venue-name fallback; 11 cases reproduce the old failures and pass in both runners.
  - [x] Replace MCP’s response-only timeout race with the existing owned-read cancellation boundary; propagate HTTP/protocol cancellation and the 20-second deadline into search and public detail reads. Two old-protocol regressions reproduce missing reader cancellation; all 34 focused MCP/direct-read/presentation/transport checks pass in Vitest and Bun, with TypeScript and 10 specs green.
  - [x] Connect Telegram turn cancellation to final Bot API sends, callback answers, typing and progress drafts, including response-body reads. Pass native Effect interruption into external conversation and delivery-claim database requests. Twelve new cases cover stalled/previously cancelled delivery, late progress and actual PostgREST read/RPC/write cancellation; all 118 focused channel/storage checks pass in Vitest and Bun. TypeScript and canonical spec validation pass.
  - [x] Connect Casamo’s shared DeepSeek client to owning cancellation for model fetch/body reads and inline-image fetch/readers. Six regression cases cover pending and already interrupted calls, image bodies, late completion and retry backoff; 38 focused model/tracing checks pass in the primary checkout, with 30 in the narrower release checkout. Primary application checks, Worker types and strict 18-item spec validation pass.
  - [x] Exercise Casamo’s existing provider-action cancellation controller and permit cleanup through actual Workers/D1 execution: request/body interruption and lease loss abort the request, free capacity and leave no reusable output. Reproduce and fix the browser acquisition/closure race with a closed-session guard; late acquisition and later reuse create no page. All 47 Workers storage/recovery checks and 75 native browser/workflow/registry/replay checks pass, with Worker types, specs and staging packaging green. Deployment verification remains in the first box.
- [x] Exercise model, tool, persistence and delivery failures locally using existing suites: BA’s 73 orchestration/read/delivery/reconnect/Telegram cases pass; Casamo’s storage, workflow and replay cases above cover lost leases, deadlines, restart reuse, uncertain responses, terminal races and notification recovery.
- [ ] Repeat the relevant interruption/failure smoke checks in deployed environments after release.

## 10. Latency and cost

- [ ] Set first-useful-result, complete-response, and cost-per-success targets.
  - [x] Define provisional first-useful/completion targets and their denominators in `docs/ai-performance.md`. Reuse the saved 72-turn frozen-corpus receipt (p50 5,116 ms; p95 9,005 ms; maximum 13,044 ms), with first-useful latency and reviewed cost explicitly unmeasured. No new model calls.
  - [x] Extend the existing repeated-trial adapter with first-useful grounded progress/completion timings, selected model/provider, separately returned model identity and token/cache/reasoning counters, unknown-versus-zero handling and measurement/transport/source identity. Thirty focused eval/quality/real-SDK checks pass in both runners. Preserve historical reports and exclude placeholder text and unreported failed attempts from measured claims; no paid model run occurred.
  - [ ] Choose the monthly monetary budget and cost-per-reviewed-success targets; the optional budget question remains pending.
- [ ] Benchmark model/configuration choices against the same quality suite.
  - Record the installed SDK’s reported mapping of configured thinking adaptive to wire enabled when comparing modes; the local identifier probe exposed this compatibility alias. No thinking behavior was changed.
- [ ] Add appropriate spending and concurrency controls.
  - [x] Add BA’s explicit 8,192-token per-model-call output cap and include it in configuration identity; the existing real-SDK transport check verifies `max_tokens=8192`. Thirty focused tests pass in Vitest and Bun, with TypeScript and 10 specs green. Retain existing step/input/retry/time/tool controls. Casamo’s existing output defaults, captured deadlines and action-resource permits are inventoried in `docs/ai-performance.md`.
  - [ ] Verify budget/usage coverage and tune existing numerical limits against reviewed quality and measured production throughput; per-call limits are not a monthly dollar cap.

## 11. Security and privacy

- [x] Add and run BA Eventos real-model malicious-source and multilingual injection evaluations.
- [x] Add and run corresponding Casamo multilingual review/photo-source injection evaluations.
- [ ] Define and verify telemetry redaction, sampling, access, and retention.
  - BA currently exports chat/tool input and model output. The optional production-content policy question is pending; trace content has not been changed by the replay fix. Langfuse’s Hobby access window must not be represented as confirmed automatic deletion.
- [ ] Verify replay masking and independent protection when database rate limiting fails.
  - [x] Set explicit PostHog replay masking of all text and inputs in both browser initializers, using the existing SDK. Both application checks and canonical specs pass. Document that URL/attribute/custom-event surfaces are separate; do not treat the configuration check as a deployed recording inspection.
  - [ ] Inspect effective deployed replay masking and review URL/attribute/event-property surfaces after release.
  - [x] Fail closed when BA’s shared Supabase limiter errors, returns absent/malformed data or stalls beyond three seconds. Preserve known quota outcomes; distinguish outages with retry guidance in web/events/feedback, and verify Telegram’s existing 503/no-dispatch behavior. No extra rate-limit service or spending ledger. Twenty-eight transport/web/Telegram checks pass in both runners, plus an isolated real events-read/events-write/feedback route probe returning 503 before payload or backend work. TypeScript and 10 canonical specs pass. Preserve the existing signed recovery/commit stages’ original admission in the release branch; deployed outage testing remains open.
- [x] Rotate and revoke the original exposed BA Langfuse setup key; verify its replacement.
- [ ] Revoke Casamo’s first setup key after confirmation; its encoded credential appeared in setup output. A privately saved replacement has verified cloud exports.

## 12. Release controls and reproducibility

- [x] Restore passing local tests, type checks, builds, and strict spec validation.
- [ ] Commit and release BA Eventos tracing/evaluation changes; verify production.
- [ ] Release Casamo Q&A removal and apply its deletion migration after backup.
- [ ] Release Casamo’s locally verified audit context-budget, title-translation and scan-profiler fixes; their separate release scope remains visible after the thin tracing release.
- [ ] Add an explicit AI-quality release gate and reproducible release receipts.
- [ ] Record code, prompt, model, configuration, corpus, results, and rollback details.
- [x] Reconcile four informational Casamo spec archive notices before archiving changes; also reconcile the later reuse/freshness notice while preserving all three current scenarios (strict validation is clean).

## Verification receipts

- Section 5 Casamo source transformations: 32 existing/new native checks pass
  across title/review translation, source-bound quotes, scoped fact catalogs,
  Airbnb/Booking facts and report evidence projection. A reproduced blank-title
  response previously erased the original title and entered the cache. Fresh
  blank/whitespace translations now remain unavailable and uncached; valid
  qualified/excluded siblings translate normally, originals stay untouched and
  later requests can recover the missing translation. Worker typing, 18/18
  strict specs and whitespace checking pass. Existing provider/sample/Worker
  fixture files were not edited. These checks exercise controlled provider
  responses and transformations; they do not establish live translation fidelity
  or independently calibrated photo/review summaries. No live provider/model
  request, database mutation, full-suite rerun or deployment occurred.
- Section 5 BA source controls: twelve cases cover English/Spanish translation,
  summaries, closed facets, venue-name extraction and absent activity information.
  The initial v1 run passed 8/12; v2 clarified ambiguous dinner/tango source labels
  and the extraction/intensity prompts, passing 11/12 with no execution errors.
  A facet follow-up exposed JSON null intensity rejecting an otherwise useful
  object. The model boundary now accepts null only as unknown optional intensity
  and omits it canonically, preserving known arrays and legitimate empty objects;
  invalid non-null enums remain rejected. The latest facet-only report is 2/3:
  tango activity recall remains open. Prior reports are retained, not re-scored
  or presented as an untouched holdout. Nineteen focused Vitest and three Bun
  grader checks, typing, whitespace and 10/10 canonical specs pass. The final
  empty-object preservation adjustment has local regression coverage; no claim
  of a fresh complete live run against that exact final version is made. Future
  receipts capture source hashes at run start. These are targeted developer
  controls, not full semantic fidelity, representative provider accuracy or
  human calibration. No database/source fetch, deployment, corpus mutation or
  Langfuse export occurred. Raw private receipts:
  `results/evals/enrichment/{1791942156082,1791942287443,1791942625527,1791942792787}.json`.
- Section 4 BA description projection: complete original English/Spanish text
  stays in search/details/saved model results; redundant rendered/summary copies
  are omitted. Records without originals retain rendered text or summary
  fallback, and canonical cards keep all stored fields. Forty orchestration/
  conversation and eleven quality-contract tests pass; four focused checks
  also pass in Bun, typing passes and canonical specs pass 10/10. Existing
  English ordinal/details/directions and Spanish refinement/newest-list cases
  pass both independent trials each (12 model-driven turns). The source corpus
  remains unchanged. Previous DTO byte counts are reconstructed from unchanged
  canonical data; they are not a fresh before-model arm or token/cost benchmark.
  No new excerpt/retrieval framework, full-suite rerun, Langfuse export or
  deployment occurred. Receipt:
  `results/evals/concierge/description-projection/receipt.json`.
- Section 4 Casamo evidence depth: six planner checks pass for conditional
  prerequisites, useful verification, settled blockers and bounded work. The
  already-verified photo suite covers selective detail passes, required
  workspace confirmation, reuse of completed batches and scoped evidence;
  standard review obligations remain required rather than being optimized
  away. No new Casamo source, model call or fixture change was needed here.
- Section 4 Casamo context budget: the shared model client applies a 64 KiB
  aggregate UTF-8 system/schema/source-text limit to declared review and photo
  v4/v5 schemas before client model/image I/O. Existing image-byte limits remain
  separate. A valid provider-reported input count above 32,768 makes the audit
  unavailable/non-retryable and retains the exact private failure response;
  findings are not accepted. Initial token overshoot is still possible. Budget
  metadata uses measured counters; absent/invalid usage remains unknown and
  caller metadata cannot replace the budget values. Complete evidence at the
  exact byte boundary remains unchanged. Fifty-six focused native checks,
  Worker typing, dependency boundaries, 18/18 strict specs and whitespace checks
  pass. The saved nine-request visual diagnostic peaked at 4,998 input tokens;
  it is a reference point, not a new live test. No new model call, scan, fixture
  edit, deployment, database mutation or full-suite rerun occurred. Receipt:
  `/Users/hanifcarroll/projects/casamo/results/model-evals/context-budget/receipt.json`.
- Section 4 BA context limits: dialogue retains at most twelve messages, two
  thousand characters per message and six thousand characters overall; current
  requests and server-owned references/search state remain separate. Provider
  telemetry records a 16,000-input-token per-request budget, including all model
  context. A completed request may overshoot; the SDK prevents another model
  step afterward. An isolated real-SDK regression proves one request, one
  successful source read and retained fallback cards after a 17,000-token report.
  Twenty-one focused checks pass in Vitest and Bun, type checking passes and
  canonical specs pass 10/10. Two existing bilingual cases with 24,000 characters
  of old dialogue seeded per trial pass all four independent trials/12 turns.
  Captured retained history never exceeds 6,000 characters; peak provider input
  is 4,807 tokens in English and 5,368 in Spanish, with no observed exceedances.
  This is bounded contract evidence, not a tokenizer, a strict preflight token
  cap, a full quality baseline or deployment verification. No full-suite rerun
  or Langfuse export. Receipt: `results/evals/concierge/history-budget/receipt.json`.
- Section 4 Casamo prompt review: current review-v3 inputs select recent reviews
  and send their text separately; photo-v5 includes topic-specific guidance and
  distinguishes low-detail detection from high-detail verification. Shared-scope
  cautions and custom-review citation conditions have distinct jobs. Legacy
  revisions remain explicit compatibility paths. No meaningful duplicate prompt
  layer warrants a rewrite for this scale; no source/config/spec/fixture change
  or paid evaluation was made for this review.
- Section 4 BA prompt consolidation: removed repeated routing instructions from
  three tool descriptions while retaining the main policy and input schemas.
  English ordinal/details/directions and Spanish refinement/newest-list cases
  each pass both trials before and after (four trials/12 turns per arm). Same
  corpus, clock, cases, model and evaluator versions are verified; reports retain
  their source hashes. Provider-reported first-step input drops from 3,780 to
  3,209 tokens in English and 3,778 to 3,207 in Spanish: 571 tokens/about 15% in
  each case. Twenty-four orchestration tests, type and whitespace checks pass.
  This bounded contract comparison does not establish calibrated prose quality,
  whole-suite coverage, total response cost or latency. An unchanged SDK warning
  maps adaptive thinking to enabled in both arms. Original reports remain intact;
  no Langfuse export or deployment occurred. Receipt:
  `results/evals/concierge/prompt-dedup/comparison.json`.
- Section 3 Casamo source grounding: 41 existing native checks pass across
  investigation evidence/assessment, qualification and shared decision policy;
  40 existing customer listing/photo presentation checks pass in Vitest.
  Checked contracts include foreign-unit rejection, exact immutable observation
  bindings, dated-price unit/intake ownership, required unknowns remaining
  unverified, missing citations preventing qualification, failed audits remaining
  unavailable, and monthly/before-tax presentation retaining its limitations.
  No implementation change or new test/harness was needed. This completes the
  local factual-field contract item, not human model-quality calibration or
  production verification. No new scans, paid model requests, source fetches,
  fixture edits, deployment or database mutations occurred.
- Section 3 BA read presentation: search/details/saved model inputs, progressive
  snapshots and final cards omit stored hidden/TBA venue addresses. Such events
  issue no standalone venue capability; pinned/follow-up facts remove unavailable
  venue IDs, and older event-owned venue handles recheck current event locations.
  Event directions fail explicitly without a map or venue-address fallback.
  Ordinary public directions remain source-derived. Model-visible free status
  and legacy read formatting agree with cards for zero prices; null prices
  without a free flag remain unknown. Missing descriptions/links stay absent,
  and model facts do not expose inferred search facets. Eighty-one focused tests
  pass across orchestration, read presentation, rehydration, shared preparation
  and source/description helpers; eleven new checks also pass in Bun. After
  correcting a test fixture's facet type, its affected regression and type check
  pass. Canonical specs pass 10/10 and whitespace checking passes. These are
  local contract checks, with no full-suite rerun, paid model call or deployment;
  they do not certify generated prose or redact addresses embedded in source text.
- Section 3 time-TBA projection: the model receives only the known Buenos Aires
  date, the explicit unknown-time flag and no end time; verified timestamps
  retain their existing local-time representation. Source timestamps/flags in
  canonical cards remain intact. Eighteen orchestration tests pass; both new
  regressions also pass in the Bun runner with UTC host time. Type checking,
  10/10 canonical spec validations and whitespace checking pass. No paid model
  evaluation, full-suite rerun or deployment occurred. Historical evaluation
  reports remain associated with their original implementation. Broader Booking
  coverage is deferred under the user's scale constraint; independent labels
  remain pending and no complete quality baseline is claimed.
- Fresh Casamo visual inputs: 34 source entries/33 distinct images are frozen
  under `results/model-evals/whole-scan/fresh-visual-v1/`. Native photo-prompt-v5
  low/detail-verification audits completed all 34 observations across three
  Airbnb galleries in nine model requests. Model-boundary inspection confirmed
  exact inline image fingerprints. File mutation/unfrozen-wire inputs fail;
  source URL reads/redirects are constrained and bounded. Historical image-byte
  equality remains unverified; these are fresh observations, not replacements
  for the old results. The 34-image blinded packet hides predictions, supports
  partial save/resume, grades room/scope/signals separately, and keeps ambiguous
  signals unmeasured. Independent labels remain zero. Fifteen focused checks
  passed across the review/media/wire modules; dependency checks pass. All images
  decode in an isolated browser with no network requests; saved edits survive
  resume. A real nonempty-media regression fixed a shared/Worker Effect-instance
  schema issue by using the schema's owning decoder. Standalone typing still
  reports the two known imported `fetch.preconnect` declaration conflicts.
  No new production scan, deployment or database mutation occurred. Ready
  visual review: `fresh-visual-v1/human-review-final/review.html`.
- Expanded Casamo corpus: four captured scans, 125 unit-assessment instances and
  117 distinct properties; both destination/submitted modes are present.
  Predictions are 31 eligible, 92 ruled out and two unverified, with zero
  independent labels. Three cases replay current supported property contracts;
  the historical Airbnb/Booking case retains policy 10/parser v2/photo prompt
  v4 and reads original assessments without producer execution or version
  upgrades. The reader validates snapshot fingerprints, owned action outputs,
  source scope and identity. Eight focused tests pass; all 125 rows render
  unfilled with no network requests. Captured operational receipts and published
  primary unit identities agree with original selection for the added scans.
  Original image bytes remain unavailable and current Booking coverage is still
  missing. No new scans/model calls or database writes occurred. Private corpus:
  `/Users/hanifcarroll/projects/casamo/results/model-evals/whole-scan/cohort-v1/`.
  The known standalone Bun/Workers declaration conflicts remain; no new-file
  diagnostics remain. Independent reviewer selection has been requested.
- Casamo scan-input preparation: `scan-worker/scripts/whole-scan-review.ts`
  validates frozen bundle/media fingerprints and source scope, reuses production
  property planning/assessment offline, hides predictions from reviewers, and
  rejects incomplete/stale/duplicate/machine labels. Six focused tests and
  dependency-boundary checks pass. A real captured scan under policy 11/current
  parser/prompt revisions produced a private 42-unit packet from 218 verified
  original artifacts. Capture used read-only D1/R2 reads (zero database writes,
  new scans or model calls); preparation made zero external requests. A fresh
  isolated browser exercised all 42 rows and partial-review export with no
  network requests; its test labels are not independent human labels. Full
  cohort coverage and coordinator/discovery/publication coverage remain open.
  The standalone Bun/Workers type check reports two existing `fetch.preconnect`
  declaration conflicts in imported provider/registry code, with no remaining
  diagnostics in the new files. This checkpoint is local tooling, with no
  runtime deployment. Private receipts/packet:
  `/Users/hanifcarroll/projects/casamo/results/model-evals/whole-scan/captured-seed/`.
  Instructions: `/Users/hanifcarroll/projects/casamo/docs/ops/scan-decision-evals.md`.
- Section 2 checkpoint: fresh BA run `1287e549-6745-43fe-8815-b9c090184f98`
  completed 24 conversations/72 turns on the unchanged corpus/cases, with an
  orchestration fingerprint matching current code. Original automatic result
  23/24 is retained: one Spanish reply was incorrectly classified as English.
  The new bilingual detector scored 99% for each language on a separate pinned
  100-English/100-Spanish PUD holdout; v2 rescoring passes 24/24 without new model
  calls. All 24 original cloud trace hierarchies and scores were verified by
  server reads after bounded read-rate backoff. Fresh prose grading completed
  68/72 with four errors/eight invalid attempts; its 38-example blinded packet
  is ready, and human calibration remains open. Added three production tool-set
  and sequential/parallel call-cap regression cases; 16 orchestration tests pass
  in Vitest and Bun, 17 focused language/harness tests pass, and BA checking has
  zero errors/warnings (89 informational Effect messages). Casamo's 67 focused
  native and 44 Cloudflare runtime boundary tests pass. Evidence and limitations:
  `docs/agent-architecture-baseline.md`. No runtime deployment occurred in this
  checkpoint.
- Initial integration: 678 Vitest and 693 Bun tests; two live concierge cases and
  a Workers export smoke check passed. This is integration evidence, not the
  complete model-quality baseline.
- Spec cleanup: BA Eventos 10/10 and Casamo 18/18 strict validation checks passed
  with no warnings or errors; four informational Casamo archive notices remain.
- Casamo Q&A removal is locally verified. No production migration or deployment
  has occurred in this task.
- Multi-turn suite: eight bilingual conversations, three independent trials each,
  72 model-driven turns against nine frozen synthetic events. Initial run
  `e22f4a92-6c2d-47c3-bd9d-4cf41234afde` passed 22/24 conversations and failed
  correctly on two unauthorized empty-result search relaxations. One dropped
  free-only status; the other dropped Recoleta. The failing original report is
  retained under ignored `results/evals/concierge/` and in Langfuse. The suite is
  implemented; the retry finding led to the guard and follow-up verification below.
- Multi-turn local verification: 689 Vitest tests, 704 Bun tests, type checking,
  production build, and 10/10 strict spec validations passed. All 11 focused
  harness tests also passed with the host timezone set to UTC.
- Langfuse export verification: three additional ordinal conversation trials
  passed with matching conversation/per-turn scores. Server reads confirmed
  three concierge turns, six generations and three tool spans per trial. These
  connector checks do not supersede the original 22/24 quality result.
- Search-retry guard: effective hard constraints are retained within each user
  turn; broader retries are rejected before event retrieval, and parallel
  searches cannot bypass the guard. Production and frozen executors use the
  same comparison. The grader still fails unauthorized attempted searches.
  Five fresh trials of the failing conversation passed in run
  `2feeecbf-51cc-443e-9dbd-30d22742b037` (15 turns, with Langfuse scores).
- Retry-fix local verification: 697 Vitest tests, 712 Bun tests, production
  build, type checking, and 10/10 strict spec validations passed. Svelte checking
  finished with zero errors or warnings; Effect diagnostics have 89 informational
  messages and zero errors or warnings. The 18 focused conversation
  and retry-boundary tests also passed with the host timezone set to UTC.
- Retry-fix full quality run `a663e9f9-272e-4369-8ded-c60cc2615c05` passed all
  24 conversation trials and 72 turns, retaining the original corpus fingerprint
  and unchanged graders. Conversation/per-turn Langfuse scores matched the
  report. Server reads verified all 24 traces, with three concierge turns and
  the expected tool spans per trace. Receipt: ignored
  `results/evals/concierge/a663e9f9-272e-4369-8ded-c60cc2615c05.langfuse-verification.json`.
  This is a conversation-contract baseline on synthetic fixtures, not a
  human-calibrated prose-quality or live retrieval benchmark.
- Task outcome definitions and independent existence, suitability, factuality,
  explanation and usefulness dimensions are documented in `docs/concierge-quality.md`.
  The evidence-capturing run `92b76bcc-1528-4cb7-bf5a-cae716f9409b` again passed
  24 conversations and 72 turns. Its first provisional prose pass graded 63/72
  turns; nine citation/applicability errors were retained, and six graded turns
  contained potentially unsupported claims. Those are automatic judgments,
  not human-confirmed failures or a calibrated baseline. Follow-up grading and
  independent human review remain in progress.
- Prose-grader diagnostics: all 14 bilingual developer-authored controls passed
  with both Flash and Pro. The full v2 Flash run graded 49/72 turns and retained
  23 citation/type/quote errors; a nine-turn Pro comparison also retained five
  grading errors. These controls do not prove live judge reliability. The
  grader is not ready for a quality release gate. A blinded 38-example local
  review form (24 actual turns and 14 diagnostic controls) and strict comparison
  tooling are prepared; no independent human labels have been supplied.
- Prose-grading local checks: the last full suites passed 704 Vitest and 719 Bun
  tests; the updated focused suites passed 20 tests. Type checking, production
  build, Svelte checking (zero warnings/errors) and 10/10 strict spec validations
  passed. Evaluation-only evidence is not added to production persistence.
- Latest prose-grading checkpoint: the v3 evidence-ID protocol with one bounded
  repair graded 69/72 turns in run `ed338da9-9abd-4e4e-a28f-cd7348620a95`;
  three grading errors and six invalid attempts remain visible. Langfuse export
  completed. This is provisional grading, not a human-calibrated baseline.
  The latest diagnostic run `342697f5-ec8c-4447-a730-312c0fc7b050` passed 13/14
  controls; the remaining control encountered a judge request/structured-output
  error. Human calibration and a reliable quality gate remain open.
- Latest complete local test runs passed 708 Vitest tests and 723 Bun tests
  with zero failures. The human-review form has further readability improvements;
  browser verification of those latest changes remains pending.
- Human review delivery: the current v3 form contains 38 blinded English/Spanish
  examples, shows one at a time, and supports partial saving and resume. A real
  browser smoke check verified navigation, completion counts, JSON download and
  recovery, with no script errors, external requests or automatic-score leakage.
  Artifact: ignored `results/evals/concierge/92b76bcc-1528-4cb7-bf5a-cae716f9409b.quality-ed338da9-9abd-4e4e-a28f-cd7348620a95.human-review.html`.
  Its synthetic UI smoke labels are not calibration evidence. Independent human
  scoring remains pending; the diagnostic request failure remains in the private
  comparison key rather than being silently omitted.
- Casamo audit tracing: the production native photo/review model boundary now
  creates metadata-only audit/model observations with scan/action correlation,
  prompt/schema versions, available hashes and usage. Missing credentials or an
  explicit disable leave the original client untouched. Bounded SDK export and
  Effect finalization preserve success, typed errors and interruptions without
  replaying a model request. Listing photos, review text, traveler requirements,
  raw responses and error messages are excluded. Casamo cloud credentials and
  server-side verification are still pending; no deployment occurred.
- Casamo tracing verification: 289 unit tests, 507 native application tests,
  57 Cloudflare tests and 479 scan Worker tests passed. Production build and
  the full type/Svelte/Effect/module-boundary checks passed with zero errors or
  warnings. Strict spec validation passed 18/18 with only the four previously
  recorded informational archive notices. After strengthening resource cleanup,
  all eight tracing tests, Worker type checking and the real-SDK Cloudflare
  export test passed again. The export test verifies v4 headers, hierarchy,
  token usage and content exclusion without live credentials or model calls.
- Cross-project transport correction: the Workers export test found that SDK
  defaults omitted the v4 ingestion header. Both integrations now set it
  explicitly. The final Casamo Workers export test passed; BA Eventos' 25
  focused evaluation tests and complete type/Svelte/Effect checks passed with
  zero errors or warnings (89 informational Effect diagnostics remain).
- Casamo experiment adapter: `bun run eval:model:langfuse review` or `photo`
  now reuses the existing audit validators, fixture parser and graders. Photo
  experiment items retain complete listing galleries and original batching.
  Only counters and opaque group identities reach Langfuse; full source-linked
  results stay local. Missing/duplicate cases or required scores fail; misses
  remain measured without changing the existing conservative safety gate.
  Receipts record fixture/configuration/evaluated-source hashes and Git revision.
  Cloud export requires server-visible matching scores and model hierarchy,
  rather than merely trusting the SDK's flush method.
- Casamo adapter verification: 486 scan Worker tests passed, including a real
  SDK experiment against a local endpoint proving one model call, linked
  model/root spans, exact scores and source-content exclusion. The real SDK
  Cloudflare export smoke test, standalone adapter type check and full project
  checks also passed. Casamo's separate project has no key yet; creation is
  prepared in its settings tab and action-time browser confirmation is pending.
  The real cloud experiment and tracing deployment remain open.
- BA Eventos source-injection suite: eight English/Spanish conversations cover
  tool-result role spoofing, credential-collection redirects, poisoned ordinal
  titles and forged prior messages. Three independent trials per case passed
  in `injection-3b8becfe-badc-4a37-a49d-d1bde3483bca` (24/24 conversations,
  72 turns), with exact malicious-input exposure verified for every trial.
  Graders retain task correctness, actual ordinal targets, hard constraints,
  canonical provenance/directions and visible attacker-string checks. All 24
  Langfuse traces were confirmed by server reads; the verification receipt is
  adjacent to the ignored run report. This targeted result is not an exhaustive
  prompt-injection guarantee. The original nine-event corpus hash is unchanged.
  Full local suites passed 719 Vitest and 734 Bun tests, type/Svelte/Effect checks
  passed with zero errors/warnings (89 informational diagnostics), and strict
  BA spec validation passed 10/10.
- Casamo task outcomes: `docs/product/scan-quality.md` defines distinct
  destination/submitted-listing success, evidence-safe qualification, failure
  categories and metric denominators. It separates engagement from correctness,
  preserves pending/unavailable outcomes and prevents completed-only cohorts
  from hiding failures. Actual production rates and satisfaction collection
  remain unmeasured. A stale trip-Q&A engagement metric was removed from strategy.
- Casamo live review diagnostic: the unchanged six-case review corpus passed
  6/6 with zero false positives, misses or execution failures in local receipt
  `results/model-evals/review-2026-10-13T18-44-12-361Z.json`. The corpus includes
  one English review-instruction attack. Casamo has no local DeepSeek credential
  configured; this bounded synthetic run used the existing DeepSeek connection
  only in the child process, removed all BA Langfuse environment keys and wrote
  no credential to Casamo. It does not verify Casamo cloud tracing, production
  configuration, multilingual review attacks or photo-source attacks.
- Casamo bilingual source-injection diagnostic: eight synthetic review/image
  cases passed all three independent trials (24/24) in receipt
  `results/model-evals/source-injection-b68a0461-906b-4445-a2d9-e54147f75261.json`.
  Six review cases test instruction-only fabricated support, hidden complaints
  and forged review IDs in English and Spanish. Two rendered text-only images
  ask the vision model to invent furniture/appliances/private scope; all six
  image trials retained unclear scope and no positive signals. Exact source
  records/inline PNG bytes were confirmed in every actual provider request.
  The existing fixtures, production prompts and graders are unchanged. Source
  images, fingerprints and all local outcomes are retained; no source data or
  BA project keys were exported to Casamo Langfuse. These are targeted developer
  diagnostics, not independent human calibration or exhaustive attack coverage.
  All 490 scan Worker tests and standalone diagnostic type checks passed.
- Casamo archive-delta reconciliation: refreshed the three already-synced
  adaptive investigation requirement blocks from their canonical counterparts,
  retaining incomplete-gallery, monthly-price uncertainty, discovery-failure
  and response-body timeout scenarios. The map delta now targets the canonical
  `Trips offer an optional evidence-linked map when coordinates are usable`
  requirement and preserves its current desktop inspector, hover behavior,
  saved-coordinate and mobile gesture contracts alongside the planned renderer
  choices and carousel behavior. Strict validation passed 18/18 with zero
  warnings, errors or informational archive notices; Git whitespace checking
  passed. Only existing change documents were reconciled. Canonical specs and
  implementation were not changed by this checkpoint, neither change was
  archived, and the map change's pending credential-backed browser verification
  remains pending.
- BA concierge cancellation: reproduced a missing signal at the actual read
  executor, then connected producer/Effect/SDK cancellation to model requests,
  authenticated history, membership, rehydration, event/venue/saved reads,
  embedding, parallel retrieval and reranking. The seven-second tool deadline
  aborts the underlying read; settling closes its scope, including remaining
  sibling requests. Late reads cannot publish cards or change successful-search
  state. Earlier validated reads retain the existing fallback. Subscriber
  disconnection still preserves the independent producer and replay contract.
  Twenty new regression checks include actual SDK generation/stream cancellation,
  stalled response-body cancellation, real PostgREST requests, context preparation,
  Effect interruption and the configured seven-second deadline with a late result.
  Model probes use isolated Bun processes, dummy keys and intercepted transports
  so other suites' mocks cannot replace the SDK; no paid model call is made.
  Full suites passed 739 Vitest and 754 Bun tests; type checking, production build
  and strict spec validation (10/10) passed. Svelte/Effect checking passed with
  zero errors or warnings and 89 informational diagnostics. Local receipt:
  `results/evals/concierge/reliability/ba-concierge-cancellation-v1.json`.
  Channel-request/Casamo cancellation and deployed recovery verification remain
  separate unfinished work; no deployment or commit occurred at this checkpoint.
- BA Eventos satisfaction collection: completed web canonical replies now offer
  localized Helpful/Not helpful controls. Actual viewport offers and explicit
  ratings are separate events; repeated selection is ignored, corrections retain
  the previous choice, and up to 200 selections/exposures survive tab reloads.
  The canonical response identifier joins votes with completed replies, clicks,
  successful saves/unsaves and ticket/RSVP intent. Shallow event details preserve
  attribution only for the selected event in browser state, including the mobile
  details-to-ticket path; unrelated details clear it and identifiers never enter
  external URLs. Streaming, stopped, failed and unpersisted replies cannot be
  rated. Ratings contain no source/prose/free-text data, stay out of GA4, honor
  DNT/GPC, and do not disrupt chat when storage or analytics fails. Reporting
  definitions use unique responses, latest votes, explicit denominators and
  unknown unrated replies; link actions are not purchases or attendance.
  Full suites passed 747 Vitest and 762 Bun tests. Type checking, production
  build, Svelte/Effect checks (zero errors/warnings, 89 informational diagnostics)
  and 10/10 strict specs passed. Real-component Chrome checks passed in English
  at 1280×900 and Spanish at 390×844, including keyboard rating/correction,
  remount/reload, actual card/detail/save/link analytics, opt-outs and no overflow
  or runtime errors. The existing real chat/SDK/guest-store browser harness also
  verifies that Stop/error-followed-by-finish do not enable failed-reply feedback.
  Browser tests intercept all network transport and stub auth/save/analytics;
  no live provider, database or analytics write was made. Receipt: ignored
  `results/evals/concierge/reliability/ba-response-feedback-v1.json`.
  Collection is local and web-only; production release, real user ratings,
  corresponding Casamo collection and satisfaction reporting remain unfinished.
- Casamo satisfaction collection: owners can optionally rate each saved ready,
  limited or no-match trip view. Outcome/view identities keep ratings separate;
  complete submitted assessments with zero qualified choices remain ready.
  No-match feedback follows recovery actions, and sample/admin/unavailable or
  unfinished states emit no named customer measurements. View, actual viewport
  offer and rating are separate events, with correction metadata and up to 200
  tab-local records. List/map/comparison/detail provider activations and only
  successfully saved personal decisions share the scan/view/outcome context.
  Named custom properties contain no source content, requirements, provider
  URLs or credentials; capture is production-only, respects DNT/GPC/current SDK
  opt-out, and does not send these fields to GA4. Standard SDK metadata and replay
  retain their own boundaries. No audit, evidence, credit or persisted trip
  contract is changed, and no retired durable usefulness or Q&A route is revived.
  Reporting definitions include latest-vote and coverage denominators, unknown
  unrated outcomes, existing Casamo checkout conversion and unobserved provider
  reservation conversion.
  Local gates passed: 297 unit, 507 native application, 57 Cloudflare, 490 scan
  Worker and 179 Storybook browser tests; production/Storybook builds and
  Svelte/Effect/module-boundary checks passed with zero errors or warnings.
  Strict OpenSpec validation passed all 18 specs/changes with no issues. All 18
  remaining protected sample/fixture files match HEAD byte-for-byte; earlier
  authorized Q&A deletions are outside that existing-file inventory.
  Chrome checks at 1280×900 and 390×844 rendered the real layout, report, feedback,
  cards, maps, comparisons and listing detail with the real browser API helpers.
  They verified SDK initialization, keyboard/corrected ratings, reload retention,
  failed-save exclusion, list/map/compare/detail attribution, sample/admin guards,
  view/outcome isolation, opt-outs, GA exclusion and no horizontal overflow or
  runtime errors. Console messages were limited to verified synthetic HTTP 503s
  and deliberately blocked requests. All transport was intercepted; source
  images were placeholders and no live analytics/database/provider write occurred.
  Receipt: Casamo's ignored `results/feedback/casamo-trip-feedback-v1.json`.
  No commit, deployment, migration, production satisfaction rate or physical
  device verification is claimed. Both projects' collection implementations are
  locally done; the parent satisfaction item remains unchecked until release
  and real-user verification.
- Section 1 release-prerequisite review: both collection receipts describe
  uncommitted local source, not deployed releases. Casamo's 18 recorded source
  hashes still match the receipt. Both worktrees contain broader changes, so
  prepare and inspect the intended release patch before committing or deploying;
  do not publish the whole dirty checkout implicitly. BA Eventos' documented
  release path is one gated Workers Build deploying Telegram, MCP, chat delivery,
  then the application Worker. Casamo's Q&A removal crosses both Workers and
  requires isolated staging verification, a verified D1 backup and migration
  ledger, active-scan inspection, and coordinated scan-first/public-second
  deployment before applying the transcript-deletion migration. No remote
  ledger, backup, deployment or live analytics receipt has been obtained at this
  checkpoint. Collection uses the existing PostHog clients; separate Langfuse
  keys are not a prerequisite for these browser feedback events. After release,
  verify actual transport and inspect a declared real-user reporting window
  using the denominators in each project's analytics document. Keep zero or
  absent ratings explicit; synthetic browser votes do not establish satisfaction.
- BA Eventos Section 1 release candidate: managed worktree
  `/Users/hanifcarroll/.codex/worktrees/ba-feedback-release/ba-events`, branch
  `codex/ba-feedback-release`, commit `270c2aa233404a56d87142ce0598a1ef3088000d`,
  [PR #5](https://github.com/HanifCarroll/ba-events/pull/5). It includes only
  reply-helpfulness/engagement collection and verified spec-format cleanup;
  model, tracing, evaluation-suite, credential and database changes are excluded.
  Rebased onto remote main `14e60909c62f61a7b9fa0ebdd9f3fedec03c99a8`, retaining
  its workflow recovery and compact Retry notice. The lifecycle-harness merge
  preserves the actual message-list rendering and adds feedback eligibility
  assertions. Two newer main-spec warnings were resolved by moving existing
  edge rules into scenarios, preserving every recovery/accessibility rule.
  From the isolated checkout, frozen installation, 687 Vitest and 702 Bun tests,
  complete Svelte/type/Effect checks (zero errors/warnings, 89 informational
  diagnostics), production build, all four Workers dry runs and 10/10 strict
  spec validations passed. English 1280×900/Spanish 390×844 compiled-component
  Chrome checks passed ratings/corrections/reloads, engagement attribution,
  unfinished controls, opt-outs, layout and runtime health. The real SDK,
  IndexedDB and Cloudflare workflow browser harness passed Stop, reconnect,
  refresh, navigation, fenced runtime recovery and exhausted-recovery Retry.
  Fixtures use intercepted/fake transport; no live ratings were generated.
  Cloudflare settings confirm nonempty public build settings and the documented
  main-branch gated build/deploy commands. The local gate retains primary public
  settings, including blank PostHog values; production SDK capture is still
  unverified. The existing application's deployment history was read separately,
  without deploying or changing settings. PR #5 is open, ready for review and
  mergeable; it has no reported commit statuses. No merge/deployment is claimed.
  Receipt: ignored `results/evals/releases/ba-feedback-release-270c2aa.json`,
  with 23 source hashes, seven check logs, spec counts and browser screenshot
  fingerprints. The original dirty worktree is preserved.
- BA Eventos Section 1 production verification: PR #5 merged as
  `228e437eaa67593531f7647b53783468419b1c4a`; its tree exactly matches tested
  commit `270c2aa233404a56d87142ce0598a1ef3088000d`. Cloudflare build
  `aaa5ea42-8100-4a1a-b487-f03f51c52712` showed successful build and deployment
  stages (5m 45s). Fresh CLI reads confirm all four Workers received new versions
  at 100% traffic, in the current release order: Telegram, MCP, application,
  then workflow delivery. Previous version IDs are retained for rollback.
  A live guest flow on `https://baeventos.com` passed completed-response rating,
  corrected/repeated selection, reload retention, desktop/mobile layout,
  Stop exclusion and Retry under the same turn/message identifiers. There were
  no runtime, console or HTTP errors in the final run. PostHog's HC Studio
  `BA Events` project (275126) confirmed exactly two completed responses, two
  visible offers and two correcting votes, with matching opaque response IDs
  and `analytics_setup=true`. All are synthetic engineering activity; real-user
  satisfaction remains unknown. SDK bot filtering was bypassed only inside the
  ephemeral canary browser, after a probe proved the default SDK rejects it;
  customer configuration was not changed. Cached taxonomy omitted the new keys,
  so raw canary records, not taxonomy absence or SDK flush alone, prove ingestion.
  Early diagnostic failures (composer selector, unavailable SDK getter, and
  counting an offer before its actual viewport exposure) were corrected in the
  temporary harness; they are not product failures. The final receipt is ignored
  `results/evals/releases/ba-feedback-production-v1.json`, retaining deployed/
  rollback IDs, the six server-visible rows, canary identities, check artifacts
  and screenshots. The build-log download timed out without a confirmed local
  file, and the CLI build-detail API denied access; no build was retriggered or
  access expanded. Physical devices/native Safari, Spanish production
  interactions, broader downstream cancellation/fault paths and Casamo release
  remain separate unfinished work. Exclude `analytics_setup=true` engineering
  activity from subsequent real-user reporting windows.

- Casamo isolated feedback release: commit `393b87075fa2ea1b18a565d700df13c1f5bf1998`
  passed 298 unit, 526 native app, 74 Cloudflare tests (6 existing skips),
  511 scan tests and 184 Storybook checks; type/Effect checks have zero errors
  or warnings, production/Storybook builds passed, and strict specs passed
  19/19. All 21 protected fixture files remain unchanged. The 21 formatting-only
  spec files preserve exact existing requirement text. PR #3 is merged as
  `f4506aa437b256a3882e46ef80282499697a6329`; production deployment/collection
  still require verification.
- Casamo staging public version `d304e542-ccf4-423e-8bdf-a40166ebce99` passed
  actual owner feedback selection, correction, reload retention and sample
  exclusion checks. The existing main migrations 0003/0004 were missing in
  staging; a private export and before/after integrity checks were retained,
  and only those additive staging migrations were applied. Temporary synthetic
  trip ownership/session changes were restored and independently verified.
  No models, scans, emails or credits were consumed. Direct `/up` navigation
  was blocked by the browser client; authenticated saved-report reads succeeded.
  Receipt: `/Users/hanifcarroll/projects/casamo-feedback-release/results/feedback/staging-verification.json`.
  Production has no pending migrations or active scans. No production database
  mutation has occurred. Q&A removal remains a separate section 12 release.
- Casamo feedback PR #3 production build `232a647f-5c04-4198-977e-65a0e0228485`
  succeeded in 3m26s. Public version `26c5f237-8651-4020-b316-5482c12fdc5c`
  is verified at 100%; `/up` returns 200/ok, and the owner report's rating,
  correction and reload UI work. The existing Chrome client blocks PostHog
  transport (`ERR_BLOCKED_BY_CLIENT`); no protection was disabled. Its missing
  votes are not treated as ingested ratings.
- A separate real-SDK canary reproduced a first-view loss during optional SDK
  initialization. The bounded memory-buffer fix preserves metadata and original
  occurrence times and rechecks privacy before capture. Baseline server records
  contained only an offer and two votes; fixed server records contain the view,
  offer and exactly two correcting votes. All canaries are synthetic and excluded
  from real-user satisfaction. Final marker:
  `casamo-feedback-sdk-startup-fix-20261013-final`.
- Startup follow-up PR #4: commit `c9c26f036d4d0e90202c9af88e1fe17664bb0e81`
  and merge `20dfdc47bdf16b08001f1f5e728c80f9763b077c`. Five new delivery
  regressions cover order, occurrence times, opt-out, bounds and capture failure.
  Final verification passed 303 unit, 526 native, 74 Cloudflare (6 existing skips)
  and 511 scan tests, build, zero-warning Svelte/Effect checks and strict 19/19
  specs. A generated-files race in a parallel check/build was resolved with the
  final serial check. Staging public `87450471-4dea-4958-a0b4-8e3a93f4077c`
  passed owner-report feedback; the temporary session was restored and verified.
  Production build `b19a2d4f-4781-4f7b-8051-970c8fdee5d5` is confirmed in progress.
  Receipt: `/Users/hanifcarroll/projects/casamo-feedback-release/results/feedback/startup-release.json`.
  Final production rollout and real-user cohort inspection remain open.
- Casamo startup production build `b19a2d4f-4781-4f7b-8051-970c8fdee5d5`
  succeeded in 3m40s. Public version `f4ac6069-c611-43b3-b602-1d55edb3e9e9`
  is verified at 100%, deployed at `2026-10-13T22:37:40.038944Z`; health is
  200/ok and the actual owner feedback controls remain visible. Merge tree
  `2ddb9f8796109a108fd80d679bb3b77cc10b492e` equals the tested commit tree.
  The original dirty Casamo checkout received only the verified startup helper,
  tests and matching spec/docs changes; unrelated work and Q&A removal remain
  intact. No production migration or business-data mutation was performed.
- First reporting snapshot cutoff: `2026-10-13T22:40:10Z`. BA Eventos window
  starts at full release `20:46:36Z`; Casamo starts at the completed startup-fix
  rollout `22:37:40Z`. Correct deployed event names were verified against source
  (the first BA query's incorrect names were discarded). After excluding setup
  flags, explicit canary properties and diagnostic URL markers, neither window
  contains reply/trip view/offer/rating records. Satisfaction and coverage are
  unknown, not zero; no booking, attendance or purchase rate is inferred.
  These short initial windows do not establish absence of future usage.
  Snapshots are saved under the Casamo release checkout's ignored
  `results/feedback/{ba,casamo}-first-reporting-snapshot.txt`.
- A temporary one-hour staging-backup download URL appeared in setup output.
  The saved export log was redacted and the backup remained private; its issued
  expiry was `2026-10-13T22:30:42Z`. No production database was exported.

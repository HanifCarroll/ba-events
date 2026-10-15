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

Current focus: BA and Casamo tracing releases are deployed and verified. Casamo Q&A removal is released and migrated in both environments; its separate audit release and independent review/data inputs remain. BA PRs #6 and #7 are merged; both production release jobs passed. Casamo PR #5 releases tracing, merged PR #6 removes
Q&A, and PR #7 carries audit context/title/profiler fixes; their local checks are
recorded below. BA PR #6 is merged and deployed; Casamo tracing PR #5 and its test-only follow-up #8 are merged; staging and production scans verify live metadata-only traces. BA’s two Supabase migrations are applied and live paid/free/unrestricted search
checks pass. The owner authorized continuing the release on 2026-10-14; independent
quality labels remain unknown and their checklist items stay open. Casamo audit PR #7 now has owner approval and successful production deployments; its single production smoke completed with two visible stays and bounded failures during a reported DeepSeek outage; independent quality and fresh positive model measurements remain distinct. Staging and production tracing are verified. The in-app browser is available again for production UI checks. The owner has deferred the planned human review for both apps; independent quality remains unverified. The owner selected a US$20 monthly spending budget, provisionally shared across both apps. Enforcement and cost-per-reviewed-success targets remain separate. The owner selected webhook-to-email alerts to hanif@hanifcarroll.com and accepts Hobby retention without automatic deletion. Avoid repeated gates on unchanged runtime.

Earlier engineering work and its receipts are recorded under each section.
Real-user satisfaction and independent human labels remain external dependencies;
leave their boxes open and return when observations arrive. Supplementary
current-version Booking coverage remains deferred for our scale. Casamo trip
Q&A removal and deletion migration are verified on staging and production in Section 12. The calendar-dependent Playwright failure is fixed on main and both Casamo release branches; all three remote suites pass.

## Execution checkpoint — 2026-10-15 01:15 UTC

The goal is blocked on the remaining human/external dependencies after three consecutive checks found no unblocked implementation task. Current releases and the single Casamo production smoke are complete; no unfinished deployment or live canary is being abandoned. Keep the original objective and every unchecked requirement intact.

Resume when any dependency clears: the owner answers the pending human-review versus deferral choice; independent labels or eligible customer ratings arrive; a spending ceiling is selected; BA's scheduled 06:00 Buenos Aires / 09:00 UTC import produces a new receipt; or a supported platform interruption/fault seam becomes available. The import is still in the future at this checkpoint. Do not generate synthetic satisfaction, relabel automatic grades as human review, trigger a paid import for evidence, or add a fault framework to clear boxes. This is an execution checkpoint, not verified completion or an approved scope reduction.

Owner review decision (2026-10-14 local time): after selecting ten examples per app and seeing BA example R001, the owner requested deferral. Defer the BA Eventos and Casamo ten-example human review until the owner chooses to resume. No human judgments were supplied. Preserve the blinded packets, frozen evidence and existing tests/evals/monitoring. Independent quality, grader calibration and quality-dependent benchmark items remain unchecked and owner-deferred where they depend on this review; no quality baseline or successful human review is claimed. This does not defer unrelated customer-feedback collection, scheduled import receipts or other engineering work. Private BA session: `results/evals/concierge/owner-review-first-10-session.json`.

Execution continuation — 2026-10-15 01:55 UTC: the owner deferred human review, selected a US$20 monthly budget and requested continued ordered execution. Sections 1–7 retain customer/owner-deferred quality dependencies; the next Section 8 scheduled import is still due at 09:00 UTC, and Section 9 has no newly available safe platform fault seam. Continue with Section 10 native provider spending controls, recording partial billing scope explicitly. DeepSeek/OpenAI Chrome access works; DeepSeek notification approval and Voyage login are pending. No full-suite reruns, paid canary, application changes or new infrastructure. The original objective is not marked complete.

Execution continuation — 2026-10-15 10:14 UTC: owner approval and Chrome sign-in clear both pending billing steps. DeepSeek USD balance email is enabled at US$5; Voyage billing/alert surfaces are inspected. The earlier Section 8 scheduled-import dependency also clears: real catalog/enrichment provenance is verified and its box is checked, with two honest Venti extraction failures retained. The remaining human-reviewed quality work is still owner-deferred; no shared hard monthly cap or full goal completion is claimed.

Execution checkpoint — 2026-10-15: completed the requested small Booking photo expansion (three listings/18 photos/six model calls) and local release-gate/reproducibility implementation. All sampled-photo protocol and seven focused harness checks pass; independent accuracy remains ungraded. Templates/docs have not been published and no deployment occurred. Human review, broader full-scan comparisons, customer outcomes, unsupported fault seams and optional shared-budget enforcement retain their stated dependencies.

Publication checkpoint — 2026-10-15: the owner explicitly authorized publishing the checklists/templates and cleanup. BA PR #14 and Casamo PR #16 contain the manual release-decision policy; the BA PR also updates this shared status ledger. Other local differences are preserved before checkout cleanup and are not automatically promoted to main. Existing private Booking photo corpora and release receipts remain private.

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
  - [x] Refresh available PostHog feedback observations on 2026-10-14. The broader window has BA 13 reply observations/three offers/four votes and Casamo two views/four offers/six votes. Excluding marked setup traffic leaves zero ratings in both projects (BA also excludes known admins/test accounts). Nine BA reply observations and one unpaired Casamo offer are not a rated-outcome baseline. Typed daily buckets and a strict timestamp-bounded metadata read do not establish eligible response coverage; retain this limitation rather than infer a rate. No purchases, attendance or satisfaction rate is observed. No new dashboard or collection code was added.
  - Feedback refresh on 2026-10-15: the explicit 21:09:08–01:10:00 UTC event-record window contains one unrated BA offer and no Casamo feedback records, below the 101-row cap. The BA admin flag is absent, so person eligibility is unknown. Both have zero new ratings in this window; satisfaction stays unknown. No test votes, new dashboard or collection change. Receipt: `results/releases/feedback-observation-20261015.json` in both repositories.
- [x] Define corresponding success measures for Casamo scan decisions, with explicit denominators and failure categories.

## 2. Agent architecture

- [ ] Establish the quality baseline before adding agents, tools, or model stages.
  - [x] Inventory the existing BA Eventos and Casamo evidence, verify available report/fixture fingerprints, and record its scope and gaps in `docs/agent-architecture-baseline.md`.
  - [x] Refresh BA Eventos' repeated conversation-contract baseline against current orchestration with the unchanged corpus and graders (24 trials/72 turns; 23/24 automatic passes, one documented language-check false positive).
  - [x] Correct the locale grader's short-Spanish false positive, validate its bilingual scope on a separate 200-sentence PUD holdout, and retain the original score/report (v2 rescore 24/24; no new model calls).
  - [ ] Complete independent BA Eventos prose labels and verify calibration/coverage (owner-deferred; existing blinded packet preserved).
  - [x] Verify Casamo's existing narrow review-audit receipt and rerun its production assessment/replay contract checks; retain the distinction from whole-scan quality.
  - [ ] Prepare source-preserving Casamo whole-scan holdouts and a blinded review packet.
    - [x] Implement the frozen-input importer, scoped source/media checks, blinded offline packet and strict independent-label comparison.
    - [x] Freeze the first captured production scan: 42 unit assessments and 218 fingerprint-verified original artifacts, with missing media explicit.
    - [ ] Expand the frozen cohort across providers, source modes, source languages and positive/negative/unknown classes; one all-negative destination scan is insufficient coverage.
      - [x] Expand available captured coverage to four scans/125 unit assessments/117 distinct properties, both source modes, mixed English/Spanish review evidence, and 31 eligible/92 ruled-out/two unverified predictions.
      - [x] Support historical Booking assessment reads with original producer versions preserved and historical/current prediction origins separated.
      - [x] Obtain a small current-version Booking source/photo sample for fresh audits; historical image bytes remain unavailable and whole-scan comparisons are separate.
        - [x] Freeze fresh Airbnb visual inputs (34 entries/33 unique images) with byte hashes, timestamps, scoped source galleries and bounded CDN reads; preserve the historical image gap.
        - [x] Run fresh native photo audits on those exact bytes, retaining delivery/protocol receipts and a blinded human-label packet (three galleries, nine model requests, 34 completed observations; quality ungraded).
        - [x] Add the owner-requested small current Booking sample using the existing frozen-photo harness on 2026-10-15: three fresh exact dated offers for October 25–November 8, six photos per selected unit (18 distinct frozen images) from full source galleries of 15/29/26. Fixed property order and first-six source order precede model work; two explicit availability failures remain retained. One run completes all three sampled galleries in six DeepSeek Flash requests with exact inline-byte coverage and schema-valid results. Seven existing freezer/delivery/review tests pass. The unfilled 18-photo blinded review packet, returned model/usage, prompt/schema/request hashes and exact local source/lockfile archive remain private. No application change, production scan, database write, new platform or original fixture mutation. Corpus: Casamo `results/model-evals/whole-scan/booking-current-20261015/`; index: `results/releases/ai-reproducibility-20261015/index.json`.
        - [ ] Supplementary whole-scan/current-inventory Booking comparisons and independent visual/decision labels remain deferred. The small photo-source wrapper has unknown Workflow timings/counts and is not a captured full-scan replay; no quality or complete-gallery accuracy is claimed.
    - [x] Add captured coordinator/discovery/selection/publication receipts alongside property replay; saved primary unit identities match captured selection in the added cases. Full operational re-execution is not claimed.
  - [ ] Obtain independent Casamo decision labels and establish the whole-scan baseline (owner-deferred; prepared evidence preserved).
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
- [x] Deploy BA Eventos tracing and verify real web/Telegram sessions.
  - [x] Merge PR #6 at `e73a1ea` and verify successful Cloudflare Build `a5c923b5-90cf-4197-b90b-8318434a1dc0`, all four new Worker versions, and Trigger.dev production version `20261014.1`. One real browser chat returns two paid events whose prices/date match database records; seven production Langfuse observations include model/tool activity and prompt/configuration identifiers. Emails/phones are masked, but a synthetic unlabeled `sk_test_` marker remains visible in the original diagnostic trace.
  - [x] Release the export-only key-prefix correction in PR #7 at `d555a93c02e2f0e642e7c74636aab8c9716be953`. Cloudflare Build `fb26d5fe-b044-4da1-9d1c-4839b0eb49d1` and Trigger.dev version `20261014.2` succeed; all four final Worker versions are confirmed. The actual browser follow-up and seven new production observations retain useful facts and mask all three synthetic contact/key markers. The first event’s advance/door price is supported by its tool source, and the conversation survives reload without browser errors. Telegram now has the same BA project credentials; the owner’s test exports a completed production AGENT with the same prompt/configuration IDs. Private receipt: `results/releases/langfuse-current/production-release-final.json` in the primary checkout.
  - [x] Prepare isolated draft PR #6 on current main; 813 Bun/798 Vitest tests, Svelte/TypeScript checks, 10 specs and the production build pass. Preserve deployed chat recovery/feedback and exclude private diagnostics.
  - [x] Configure BA’s project-specific Langfuse keys, US base URL and production environment on both application and Telegram Workers; real web/Telegram traces are verified.
  - [x] Apply the prepared migrations before merging. Both applied on 2026-10-14 through the connected Supabase integration; local filenames match the recorded remote versions. Twelve live semantic/lexical paid/free/unrestricted checks pass with no wrong-status results. The additive jsonb column exists and both functions retain security-invoker execution. Original function definitions and migration/verification receipts are private under `results/releases/langfuse-current/`. Existing advisor notices remain, including [mutable search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable); no new grants or privileged execution were introduced.
    - Read-only live check on 2026-10-14 confirms the `enrichment_provenance` column is absent (42703). The lexical RPC returns an existing paid event without a free-status constraint and zero results with explicit false. The prepared migration is still required; no schema write occurred. Private receipts: `results/releases/access-refresh/database.json` and `lexical-filter.json` in the primary checkout.
  - [x] Apply BA's additive `20261014144351_add_enrichment_provenance.sql` migration and publish the import/enrichment pipeline through successful Trigger.dev production versions `20261014.1` and `.2`; older rows remain unknown, with no speculative backfill.
  - [x] Observe a newly processed production enrichment/import receipt under the released revision; publication alone does not prove the next scheduled job or its provenance write.
    - Production observation on 2026-10-15: the 06:00 Buenos Aires scheduled run `6ffee0de-a269-4093-906c-1d2caa6a631e` starts at 09:01:08 UTC and completes its catalog at 09:11:32 UTC. All six sources succeed and persist `catalog-import-v1`, real observation times, configured DeepSeek/embedding model IDs and embedding version 2. Eight freshly completed rows inspected around 09:20–09:21 UTC contain `event-enrichment-v1` with separate source/processing times; stored-description inputs correctly keep unknown original observation times. The enrichment chain reports 116/118 successful, with two Venti extraction failures retained (not a fully green batch). The health command exits 1 for those real failures despite healthy catalog sources. No new import/model call or database write. Receipt: `results/releases/pipeline-observation/production-provenance-confirmed-20261015.json`; raw reads and the failed event IDs are retained beside it.
    - Venti failure triage at 10:15 UTC: two bounded public catalog reads find both failed slugs with empty descriptions; their HTTP-200 HTML contains purchase metadata and a JavaScript shell. No available catalog description was lost by the importer. Keep the two failures/source gaps visible without invented prose, forced paid retries or a parser patch. Receipt: `results/releases/pipeline-observation/venti-source-descriptions-20261015.json`; original event failures and HTML are preserved.
    - Read-only refresh at `2026-10-14T19:30:03Z` finds zero non-null enrichment provenance rows and zero import runs after release. The latest pre-release daily chain completes 102/102 with zero enrichment failures; all six source results succeed, including Luma, while observation ages/counts remain unknown. Upcoming inventory is 1,572 with 25 missing both descriptions and zero failed enrichments. The next declared scheduled run is 2026-10-15 06:00 Buenos Aires (09:00 UTC). Do not manufacture a new paid import just to fill this receipt. Private source/provenance observations: `results/releases/pipeline-observation/` in the primary checkout.
  - [x] Apply `20261014144355_fix_paid_only_search_filters.sql` before the changed search client, and verify paid/free/unrestricted searches through the deployed functions.
- [x] Instrument Casamo scan/model audit execution locally with optional, metadata-only tracing.
- [x] Configure Casamo project keys and verify cloud traces, staging scans and production execution.
  - [x] Save the project key in ignored local .env and verify review/photo experiment traces and scores in Casamo Cloud.
  - [x] Prepare isolated Casamo draft PR #5 (https://github.com/HanifCarroll/casamo/pull/5) for metadata-only tracing and the existing eval adapter; full native release gate, build and staging scan Worker packaging pass. Existing Q&A/context-budget changes remain separate pending releases.
  - [x] Configure project-specific Langfuse credentials, US base URL and production environment on Casamo’s private scan Worker.
  - [x] Create and privately save the separate staging Langfuse key, verify Casamo project access (HTTP 200), and configure six staging Worker settings. Owner Google sign-in permits the normal scan flow; CLI service-auth canary remains unavailable. Both exposed setup keys are revoked after owner confirmation; only private replacements remain.
  - [x] Verify the completed normal staging scan, audit/model cloud traces and metadata-only payloads.
  - [x] Release production code and verify the completed two-listing scan, three review/photo audit-model trace pairs, usage, action/scan correlation and metadata-only input/output. Both Workers are active at 100%; source URLs are absent from the inspected cloud observations. Private receipt: primary Casamo results/releases/production-release-final.json.
- [ ] Configure quality, latency, fallback, errors, usage, and cost views and alerts.
  - [x] Reuse the existing Langfuse Home, Agent, Latency, Cost and Usage dashboards in both projects; save and reopen a project-specific production-error widget in each (production + ERROR + GENERATION). No dashboard framework, runtime code or model reruns were added.
  - [x] Finish production model-error email alerts for both projects to hanif@hanifcarroll.com (count > 0 over one hour, missing data NO_DATA, renotify off). The owner selected webhook-to-email and approved creation/enabling on 2026-10-15 UTC.
    - [x] Implement and merge the signed, bounded ingress using Casamo's existing email queue, ledger and provider idempotency. PR #15 (https://github.com/HanifCarroll/casamo/pull/15), merge `41c2e75c5be9452ce4bbb1dfe875097d29fc05af`; full checks, 312 unit/515 native/77 Cloudflare/488 Worker tests, 18 spec/change validations and production build pass. Staging rejects an invalid signature, accepts valid/repeated requests, and records one sent delivery with one provider attempt. Initial secret-propagation 503 is retained separately. Inbox delivery unobserved. No new service, table or ledger.
    - [x] Complete both native production builds, configure the separately generated signing secrets, save both alerts, and verify production provider delivery. Native public build `00ba2d3a-64ec-476a-9b59-6565e2234b4d` succeeds (4m47s), private build `674e9316-0ae1-4f52-a68b-90a1f2a2e7be` succeeds (4m05s). Private version `a07f1124-bbc7-4aad-8ccf-a8105961e4dd` precedes public code `9ff08e82-6080-4d19-b27d-a96b925ce2ea`; signing secrets are enabled in public version `5d281496-97f1-4e99-ba16-ef91df5ac0c0`, all at 100%. BA alert `cmv8t8iml042iad0j8rjskwgo` and Casamo alert `cmv8t8imy03itad0ehg2px8ja` are active; saved filters, count > 0, one-hour window, NO_DATA and renotify off are read back. One clearly labeled setup email per project reaches the existing provider with sent status, one attempt and no error at 00:38:25–26Z. Inbox arrival and a real incident transition remain unobserved; no model failure was fabricated. Receipt: `results/releases/langfuse-email-alerts.json` in both repositories.
    - Real-incident follow-up: the approved audit smoke later encounters natural photo-audit network errors while DeepSeek reports an active Flash API partial outage (https://status.deepseek.com/incidents/7116348214287). Casamo's alert visibly changes to ALERT; provider event `d8b4e681-3e78-46db-8b32-6b9e56545829` reaches the email provider with sent status, one attempt and no error at 00:54:14Z. This is actual Langfuse-webhook delivery evidence, not a fabricated model failure. Inbox arrival remains unobserved. The scan's own retry/terminal outcome stays separate.
  - [x] Verify deployed metric coverage, fallback measurement and cost/model-price mappings; empty production views do not establish healthy traffic, measured quality or total provider spending. Keep human-calibrated quality rates under Section 7.
    - [x] Read production model timing/error/usage coverage through the existing Metrics API and reuse the current dashboards. On 2026-10-14 21:09 UTC, BA has 10 production generations/40,190 tokens (mean 2,661 ms, p95 4,703 ms); Casamo has 11/26,113 (mean 2,384 ms, p95 3,413 ms). Both observed groups are DEFAULT level; this setup-heavy sample does not establish customer health or independently graded quality. Earlier unpriced records stay unknown. A complete read of the owner’s existing Telegram trace finds seven observations with two generations and a search tool; the prior one-AGENT summary was a projection, not missing model tracing. No model rerun.
    - [x] Measure BA’s recorded guest-web canonical fallback using the existing guest_request_lifecycle ledger. The same-day read finds four recorded completions/no fallback, with a complete bounded query. Denominator is completed + completed_with_fallback; started/errored, missing best-effort writes, signed-in web and Telegram are separate. Preserve the synthetic cohort distinction. Reproducible source/units are documented in docs/langfuse.md; no new ledger or runtime collector.
    - [x] Release Casamo’s scoped image-transport fallback flag into Langfuse and verify read visibility. The existing native model meter retains eight response metadata records for the production cost canary (seven photo/one review), with no inline marker; an empty provider-attempt table is not a zero-request/fallback measurement. PR #13 (https://github.com/HanifCarroll/casamo/pull/13) exports inline/none/unknown for a completed native transport response; failure, legacy/custom metadata and caller overrides stay unknown. Four real-client/Workers-export regressions fail before and pass after; 18 SDK checks, 302/515/77/487 tests, app/Effect/types, build and 18 specs pass. Staged source a605cce097b87f59429621682be6f116a21d3eb5 preserves the unapproved audit safeguards; staging canary 695e1d11-d7a6-4535-ac08-f61d4548633d completes with two stays and six model observations exposing none/completed_transport_response with metadata-only payloads. PR #13 merges at 876dd386f7478193ac2dfe40e47f6054de88a2a5 with exact checked tree cae3de10ce0acf7b4a929043a6386d269c035c12; main browser run 38641934891 and native private build pass. Private Worker 41525d1d-fea8-41b9-900e-602e4951bb0b is active at 100%; public runtime is unchanged. Production scan a943a6fe-4fc7-4bc7-a0de-d3997a04103b completes with two stays and a notification-sent record (inbox unobserved). Twelve metadata-only observations contain six successful model responses, all exposing none/completed_transport_response under release 876dd386f7478193ac2dfe40e47f6054de88a2a5. The offline real-client/Workers test proves positive inline recovery with exactly the original two provider requests; it was not forced against production. Historical records stay unmodified/unknown. Receipt: Casamo results/releases/fallback-observability-release.json.
    - [x] Release and verify BA’s export-only DeepSeek Flash token-cost estimate, with published UTC peak/off-peak rates, separate cached/uncached input, preserved unknown/supplied cost and estimate/rate/time-basis metadata. All 190 available Langfuse definitions were inspected and none matched DeepSeek. Local checks pass: 24 focused exporter/cost checks in both runners, 885 Bun/870 Vitest tests, Svelte/TypeScript, 10 canonical specs and production build. PR #9 at `5bbd007` initially stored $0.00089796 in component estimates but the Metrics API reported zero: retain that original partial-cost diagnostic. PR #10 at `de94c902b4133989b48bb5bf93ce0eab16cb1183` adds the explicit aggregate total; native Workers and Trigger.dev checks succeed and all four deployed Worker versions are recorded privately. One fresh production request completes with two recommendations/two generations; component and total fields match $0.000578328 within storage precision, and the Metrics API reports $0.000578327999 across 7,501 tokens. Prompt/configuration identity and contact/key redaction are unchanged. Receipt: `results/releases/langfuse-cost-production.json`. This is a bounded telemetry canary and published-rate estimate, not a quality baseline, invoice or whole-provider spending claim. Casamo’s corresponding change follows BA.
    - [x] Release and verify Casamo’s response-scoped DeepSeek Flash estimates and unknown-versus-zero usage. Tracing-only PR #12 (https://github.com/HanifCarroll/casamo/pull/12) has checked tree `0861e1137a8df2eb48ea03cfa5aca5cdbc068c6c`; 302 unit, 515 native, 73 real-Workers and 487 scan-Worker tests, app/Effect/types, build and 18 strict specs pass. GitHub e2e `38634639599` and the private Workers branch build pass. The provider protocol supplies model/counters; caller metadata cannot override them, raw bodies stay private and totals are explicit. The staged audit branch retains its unreleased safeguards, passes 302/523/73/493 tests and current checks/specs, and deploys the cost change under `60832574f83534040b3ab76eb801aaa6f72f4c57`. Normal staging scan `5f8a5494-113e-4673-b90c-a593bb43fe10` completes with two stays. Fourteen metadata-only observations contain seven reported model responses; their $0.003638808 estimate matches the Metrics API total across 18,300 tokens. PR #12 is merged at `ceff1e7d80fa38675c0dd8d40b9dd5ff9005edc9` with the exact checked tree and zero active production scans; native private build `e008a95c-6306-4381-b2f1-ab4630ec76b8` and main browser run `38635478959` pass. Private Worker `df9bcdeb-b9de-4e26-9039-ef2cd4eeb844` is active at 100%; the public Worker is unchanged because pricing affects private audit tracing only. Normal production scan `40bb4a55-8a6d-410c-a7e9-c7a07ec4818b` completes with two stays and a recorded notification-sent timestamp (inbox unobserved). Sixteen metadata-only observations contain eight reported model responses; $0.003242676 in component/total estimates matches the Metrics API across 20,889 tokens. No extra quality eval or historical backfill was performed. Internal retries/invoices remain outside the estimate. Receipt: Casamo `results/releases/langfuse-cost-release.json`. Audit PR #7 still requires its separate owner approval.
    - Scope checkpoint 2026-10-15: the saved Metrics API, guest-lifecycle, cost-release and fallback-release receipts prove the stated observation/estimate coverage. This telemetry verification is complete; independently calibrated quality, whole-provider spending, legacy/failed attempts and customer health remain unproven in their own sections. No model rerun or new telemetry layer.
    - Historical BA observations with empty cost fields remain unmodified and unknown. Current priced Flash generations have explicit totals; failed/unreported attempts and other providers remain outside this estimate.
- [ ] Attach prompt/configuration identifiers and promote reviewed failures into regression cases.
  - [x] Add BA’s explicit prompt revision and a fingerprint of selected model/provider, contract, supplied tools, limits, retries and thinking options. A real-SDK local export probe verifies stable identity across different messages and changed identity across selected models; no external model calls. Thirty focused orchestration/cancellation checks, TypeScript and 10 specs pass.
  - [x] Add Casamo’s declared request-configuration fingerprint alongside existing prompt/schema revisions and available hashes. Real Workers SDK export, metadata-only exclusion checks, nine native tracing/SDK checks, Worker TypeScript and strict 18-item validation pass.
  - [x] Retain reviewed deterministic failures as regression cases: BA paid-only serialization, bilingual live-music exclusions, nullable enrichment output and grounding/cancellation cases already have direct checks. Do not relabel Casamo’s disputed photo fixture or unreviewed prose as accepted regressions.
  - [x] Verify BA prompt/configuration identifiers on real production web and Telegram traces.
  - [x] Verify Casamo prompt/schema hashes, configuration fingerprints and action/scan identifiers on deployed staging and production traces.
  - [ ] Promote independently reviewed quality failures after labels arrive.

## 9. Reliability and recovery

- [x] Fix the saved-trip resume/access mismatch reproduced during the Casamo audit staging check. Two paid-only guards prevented usable account access from resuming a saved `created`/`checkout_started` intent. [PR #10](https://github.com/HanifCarroll/casamo/pull/10) reuses existing owner/access/status rules while retaining Stripe verification, confirmation and atomic admission. Two real SQLite regressions fail before the patch and pass afterward; 302 Vitest, 515 native root, 60 Cloudflare, 487 Worker tests, application/Effect/Worker checks, build and 18 strict specs/changes pass. The exact failing staging intent `8542724f-2210-41ae-8f14-0614d5d2f8c5` starts and completes scan `272d6a51-fb17-4509-a96c-54c3947e6d07` with one job/one debit and no manually changed payment status. Merge `8a13c17c65d6e37208827234c8f45958cebc8911` matches checked tree `d3149bb10f79d98daf97b242046f4eb9e83cf10a`; both native production builds deploy it, private first. Final 100% versions after release metadata update are private `83945215-dd35-485e-8c6e-e62bbc82f572`, public `4cf8f1a1-0066-4c92-9073-bb2477bca4ba`. Main CI `38610847629` passes; signed-in production account remains active with 9,999 searches. Private receipt: Casamo `results/releases/saved-trip-access-production.json`. No new production model scan or migration was needed.
- [ ] Verify deployed interruption, cancellation, replay, and recovery behavior.
  - [x] Check BA production guest delivery on 2026-10-14: Stop before submission returns 204 and fences the delayed start with 409 without a debug/model record; Stop during preparation and after trusted search progress returns 204 and replays a stopped error without a canonical response. A disconnected subscriber resumes contiguous offsets, saves one response, and replays identical content without a second model run (one debug row, one completed concierge run with two model steps). Wrong capability returns 403, changed input returns 409, and late Stop after completion returns 409. The first two expired logs return 410 after ten minutes. Private receipts: BA `results/releases/reliability/`. An initial progress-threshold diagnostic completed normally and is retained as an unsuccessful cancellation probe, not a Stop pass.
  - [x] Resolve BA web canceled-run trace visibility and observe SDK cancellation timing after the tracing leaf correction. The original failed cases remain retained; absent spans were not proof of zero work. The released case exports seven observations, including a generation active at the recorded Stop that closes 85 ms afterward with unreported usage. No canonical response is saved. This proves the observable SDK boundary, not vendor compute cessation, billing or refunds; SDK DEFAULT levels do not classify this intentional Stop as a completed product response.
    - [x] Release the incoming-request cancellation flag and streamed cleanup wiring in BA PR #11, merged at 716e694674f9fcad08cc01b819234cca34ad3cb8. 885 Bun/870 Vitest tests, combined Svelte/Effect checks, TypeScript, 10 specs, production build and packaging pass. Native build 9efa857a-9296-4828-ac7a-df2d46d8ac24 and Trigger.dev deployment pass. Final public version ed1a4580-fed1-455b-88c5-5b4c68cdf00a retains the verified flag and release tag. The one deployed progress-Stop case 0169e673-d171-4c6c-a09a-f20c3e8bc490 returns 204 with no canonical response; two bounded trace reads still find no observations after 98 seconds. Retain this failed observability result; delivery fencing alone does not prove upstream cancellation. Receipt: BA results/releases/reliability/cancellation-cleanup-release.json.
    - [x] Release BA PR #12 at 85399349aaa9c2cad1b89916a37d3c090f18f00f, tree 44171f2d630cd53a38d237420a189133f2cb1f8c. The actual tracing SDK/Effect regression fails before and passes after, with one execution and zero network calls. 886 Bun/871 Vitest tests, Svelte/TypeScript, 10 specs and the build pass; the fixture warning is corrected with a passing strict diagnostic and focused regression. Native build ea81cfa0-151c-4aa4-950a-a22bca24b4db and Trigger.dev deployment pass. Model-producing Workers carry release metadata: public b162529a-6a78-42d3-b44a-2a97e2ab7327, Telegram 731cc48c-a0a4-485e-b376-52a539ca8d8e; MCP cbb2b009-9782-4f0e-8ae8-27f6a1fe700c and chat delivery 15a36fc1-7056-4d62-95df-7aec5976b70c are active at 100%. The sole new Stop case 870f8781-b92e-4df2-a1ec-72b239bad65d passes, and seven production observations retain prompt/configuration/release identity. Receipt: BA results/releases/reliability/trace-leaf-release.json. Further web Stop probes are finished; Telegram interruption, unsupported object-restart/fault seams and Casamo staging recovery remain separate.
  - [x] Run Casamo's existing staging recovery canary once operator access is available. Owner-approved 24-hour credential `Casamo staging recovery 2026-10-14` is saved privately in `.env.staging` and added only to the existing staging Service Auth policy alongside its original token; production access is unchanged. Single run `recovery-20261014` passes at 2026-10-14T23:50:33.675Z: stranded outbox dispatches on the existing schedule; expired dispatcher lease recovers through preview/confirmation/execute; stale expected-version recovery is rejected; seeded ambiguous-dispatch state reconciles. All three preserve envelope/downstream identity and finish without a lease. Scoped cleanup is verified at 23:51:14.022Z. No model calls, delivered emails, application changes or repeated full suites. Receipt: Casamo `results/releases/staging-recovery-canary.json`.
  - [x] Observe real production upstream-model failure and cleanup during the approved Casamo audit smoke. A photo and a review audit each stop after three network-error attempts, become unavailable, and allow report preparation to complete with two visible stays and a notification record. All running attempts and resource permits clear. Metadata-only error traces and the actual email alert are observed. This does not establish duplicate consumer delivery, stale scan-stage lease, object restart, intentional cancellation or a normal fresh successful model response. Receipt: Casamo `results/releases/audit-reliability-production.json`.
  - [ ] Complete remaining deployed interruption/fault coverage when supported seams or owner participation are available: BA Telegram lifecycle interruption and object-restart faults (both need supported platform seams; the bot has no Stop action and /new is an ordered history reset); Casamo duplicate consumer delivery, stale scan-stage lease and actual ambiguous-dispatch network fault. These are not established by the successful synthetic outbox run; do not inject faults into real customer jobs or add a fault framework for this scale.
  - Telegram seam correction on 2026-10-15: current main runs each ordered alarm item through Effect.runPromise; supported commands expose no active-turn Stop/cancel. /new waits its turn and clears history, so sending another owner message cannot prove interruption. Retain local cancellation tests and the unverified deployed lifecycle case; no user test, Bot API send, feature addition or fault framework is introduced. Receipt: `results/releases/telegram-interruption-seam.json`.
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
  - [x] Record the owner-selected monthly AI/provider spending budget: US$20 (owner reply on 2026-10-14 local time). Provisionally interpret this as shared across BA Eventos and Casamo, pending clarification if the owner intended US$20 per project. This records a planning budget; no enforced dollar cap or spending alert is claimed.
  - [ ] Choose a cost-per-reviewed-success target after useful human quality and cost evidence is available; the US$20 monthly budget does not specify this target.
- [ ] Benchmark model/configuration choices against the same quality suite.
  - Record the installed SDK’s reported mapping of configured thinking adaptive to wire enabled when comparing modes; the local identifier probe exposed this compatibility alias. No thinking behavior was changed.
- [ ] Add appropriate spending and concurrency controls.
  - [x] Add BA’s explicit 8,192-token per-model-call output cap and include it in configuration identity; the existing real-SDK transport check verifies `max_tokens=8192`. Thirty focused tests pass in Vitest and Bun, with TypeScript and 10 specs green. Retain existing step/input/retry/time/tool controls. Casamo’s existing output defaults, captured deadlines and action-resource permits are inventoried in `docs/ai-performance.md`.
  - [ ] Verify budget/usage coverage and tune existing numerical limits against reviewed quality and measured production throughput; per-call limits are not a monthly dollar cap.
  - [x] Inspect existing provider billing/control surfaces after the owner-selected US$20 budget, without new model calls or an application spending ledger. On 2026-10-15 01:55 UTC, DeepSeek’s October/GMT-3 view shows US$1.83 for the selected BA Eventos/Casamo Prod/Casamo Local key labels and US$16.33 prepaid balance; all account keys show US$2.47. The account also serves other apps. OpenAI’s project table shows rounded monthly amounts BA US$0.01/Casamo US$0.42; BA has no project spend limit, and the organization’s US$100 limit is not enforced (existing alerts US$80/US$100). Voyage reranking billing is login-blocked. These are partial rounded billing observations, not a whole-provider total, invoice or enforced shared cap. Local BA/Casamo DeepSeek credentials match; deployed identity is unverified. Receipt in both primary repositories: `results/releases/spending-controls/current.json`.
  - [x] Enable and verify the owner-approved native DeepSeek US$5 balance email on 2026-10-15: saved and reopened USD alert on/threshold 5, CNY off. Inspect signed-in Voyage HC Studio / BA Eventos: October spend displays US$0.00; project Budget Limits exposes email alerts with no hard cutoff shown, and none is configured. No purchase, recharge, credential, paid model request, application change or release. Receipt: `results/releases/spending-controls/current.json` in both primary repositories.
  - [ ] Decide per-provider allocation/enforcement for the shared US$20 monthly target if required; the low-balance notification is not a monthly cap, and whole-provider spending remains incomplete. Do not cap unrelated projects or add a cross-provider spending service for this scale.

## 11. Security and privacy

- [x] Add and run BA Eventos real-model malicious-source and multilingual injection evaluations.
- [x] Add and run corresponding Casamo multilingual review/photo-source injection evaluations.
- [x] Define and verify telemetry redaction, sampling, access, and retention.
  - [x] Release and verify the production-smoke fix for unlabeled underscore-delimited secret/restricted key prefixes. The change only affects exported text; model inputs/application results stay unchanged. Four redaction/export tests pass in both runners and all ten specs validate. PR #7 is deployed; the fresh web trace masks the synthetic token while preserving useful content. The original synthetic-marker trace remains a recorded failed privacy diagnostic, not a real credential exposure or a passing check.
  - [x] Implement the owner's content-with-redaction policy for BA in an export-only copy of all span attributes, status/errors, events and links, covering Langfuse and raw AI/GenAI fields. Retain useful chat/tool facts, usage and correlation IDs; leave model inputs/application responses unchanged. Common emails/international phones, credential fields/tokens and URL queries/fragments are masked. Six focused checks pass in both runners; a real SDK/default OTLP loopback capture verifies three mocked generations with redacted payloads and identical application outputs, with zero paid/external model calls. Redaction failures omit the span. Names, addresses, arbitrary secrets and historical data are not claimed anonymized. Casamo retains metadata-only audit tracing.
  - [x] Verify deployed payloads and settle project sampling/access/retention. The corrected BA production follow-up excludes the synthetic email, phone and token; the original failed prefix diagnostic stays retained. Casamo's inspected production traces are metadata-only with source URLs absent. These are scoped payload proofs, not exhaustive anonymization or guaranteed delivery. Human access and configured sampling are verified below; the owner accepts Hobby with no automatic deletion.
    - [x] Inspect current Langfuse organization/project human access: HC Studio and both BA Eventos/Casamo member tables each show the single owner account, with a complete one-page result. Project-specific roles are N/A on Hobby; separate projects/credentials remain, rather than isolated human permissions. No membership or credential changes were made.
    - [x] Verify the configured production tracing sampler without new model calls: BA web/Telegram and Casamo private audit Workers are active at 100% traffic and have no OTEL_TRACES_SAMPLER/ARG override. Version-matched OpenTelemetry 2.12.0 (BA) and 2.6.0 (Casamo) use parentbased_always_on: root selection is 100%, child selection inherits its parent. BA exports supported Langfuse/GenAI/LLM spans through redaction; Casamo exports local audit spans with metadata only. Missing/disabled credentials, redaction/export failures and Worker lifetime remain delivery limits; this is not a claim of exhaustive observed trace delivery. No runtime or policy change, test rerun or paid request. Receipt: results/releases/tracing-sampling.json.
    - [x] Record the owner-approved retention policy on 2026-10-15 UTC: keep Langfuse Hobby and accept no automatic deletion for now. The live plan and [retention documentation](https://langfuse.com/docs/administration/data-retention) establish that the 30-day access window is not a deletion guarantee. No upgrade, cleanup service or deletion was performed. Organization AI features and AI data use for product/service improvement remain enabled as observed; they were not changed by the retention decision. Private access/retention and scoped deployed-payload receipt: results/releases/langfuse-privacy-access.json.
- [ ] Verify the owner-approved replay policy and independent protection when database rate limiting fails.
  - [x] Historical policy (superseded by owner request on 2026-10-14): set explicit PostHog replay masking of all text and inputs in both browser initializers, using the existing SDK. Both application checks and canonical specs pass. Document that URL/attribute/custom-event surfaces are separate; do not treat the configuration check as a deployed recording inspection.
  - [x] Separately mask automatic interaction text and element attributes and disable copied-text capture in both existing PostHog initializers. Keep page views and named outcome events. Both primary application checks pass with no errors/warnings; primary and release specs validate (Casamo release retains its four pre-existing archive INFO notices). This is a configuration/type check, not an inspected network payload or deployed recording; replay DOM attributes, URL and custom-property review remain open.
  - [x] Historical replay-attribute policy (superseded by owner request on 2026-10-14): enable built-in replay DOM-attribute masking and captured URL-fragment stripping, and omit PostHog page titles in both projects. Replace Casamo’s dynamic GA4 title with `Casamo`, so private report destinations/listing names are no longer supplied as page titles. Record reduced replay styling/image fidelity. Both Svelte checks pass without errors/warnings and canonical/release specs validate. No SDK upgrade, new filtering layer or paid eval run. Named event callers reviewed supply bounded IDs/counts/enums rather than prose or source URLs; this is a source/configuration review, not deployed payload proof.
  - [x] Review URL query/referrer handling and verify effective deployed payloads under the declared policy; existing/historical telemetry is not retroactively redacted. Owner-approved unmasked DOM links and arbitrary custom fields remain separate from network/event URL controls.
    - [x] Configure SDK masking for declared sensitive auth/search/intake URL query names (including Casamo retry requirements and listing URLs), disable referrer collection and deny referrer event properties. Both Svelte checks and release specs pass after shortening the Casamo requirement that triggered the >500-character warning. Exact-name masking requires review when introducing new query fields; replay/network URL coverage and deployed payload checks remain open.
  - [x] Release the owner-requested removal of all replay text/input/DOM-attribute masking, including the SDK password-input default, in both apps. BA PR #8 plus bilingual notice correction are on main at `6b2109f`; production public version `d536a64a-66a3-4ebb-a81d-3c24a75ac96a` is active. Casamo PR #11 is merged at `7e22ed5`; production public version `7ad5c663-6c7b-42e4-808c-feb83800d735` and staging public version `12da3e0d-d3ed-4eda-b531-6f199de8c47d` are active. Notices and canonical specs disclose visible replay content. BA 865 Bun/850 Vitest tests and Casamo 302 Vitest/515 native/60 Cloudflare/487 Worker tests pass, with checks/build/spec validation (four existing Casamo archive INFO notices). Casamo main Playwright/native build and BA native build/Trigger.dev checks pass. The pending audit branch incorporates this approved policy without promoting audit changes. Automatic event masking, URL redaction and Langfuse policies remain separate. New replay payload inspection stays open below; historical recordings were not modified. Private receipts: each primary checkout `results/releases/replay-policy-production.json`.
  - [x] Inspect effective deployed unmasked replay and review the separate URL/event-property surfaces after release.
    - [x] Restore PostHog recording access after owner reconnection and Codex restart. Both project contexts work; recording list/get are exposed and Casamo's owned canary recording 01a13c5e-b327-7e22-8ff8-045cc29beadf is readable. It visits test report a943a6fe-4fc7-4bc7-a0de-d3997a04103b after the unmasking release (21:43–21:51 UTC; 260 recorded events). Metadata is not proof of visible text/input values. BA's bounded post-release engineering-marker query returns no recording; this is not proof that all BA recording is broken. No scanner or model requests were added.
    - [x] Inspect Casamo's effective post-release replay in the signed-in PostHog player: the recorded submitted-listing textarea retains both original public listing URLs, ordinary input values and page/report text are visible, and a recorded provider link retains its travel-date query attributes. These are owner-approved unmasked DOM surfaces, separate from ordinary event URL masking. Evidence: results/releases/replay-inspection/casamo-unmasked-input.png and casamo-input-frame.txt. Password fields were not exercised; no new scan or model request was made.
    - Read Casamo's 13 ordinary analytics events in that exact session/window: referrer values are absent and captured page URLs have no query or fragment. The sample does not challenge sensitive-query masking or establish network-payload handling. Private access receipt: results/releases/replay-inspection-access.json.
    - [x] Inspect BA's effective post-release replay from the owner's ordinary-browser check: recording 01a13cbf-3cc0-7bb7-97cb-a6b81c903146 starts at 23:28:48.653 UTC and renders the stored landing-composer value and page text unmasked. Later playback also contains the same text in a chat; the agent initiated no model request, and this owner diagnostic is not an independent product-quality outcome. Evidence: results/releases/replay-inspection/ba-unmasked.png and ba-input-frame.txt. Password fields were not exercised. The original automated marked draft's missing recording remains retained as an unsuccessful probe, rather than a customer-wide failure.
    - [x] Resolve PostHog's null sampling setting through the live settings UI in both projects: legacy conditions display Sampling 100% (default), no trigger groups, no URL/event/feature-flag triggers or blocklist, and no minimum duration. Both projects keep network timing capture enabled and header/body capture disabled. Configured recording retention is 30 days; both inspected recordings expose that period and an expiry timestamp. Browser opt-outs, blocked transport and eventual deletion timing remain separate from configured sampling/retention. Read-only settings evidence: results/releases/replay-inspection/{ba,casamo}-replay-settings.txt.
    - [x] Inspect BA's ordinary event/referrer/fragment fields using corrected explicit UTC bounds: the same owner recording yields 10 events, all with absent referrer values and stripped captured URL fragments. The harmless engineering query remains in page events; chat outcomes use their chat URL. The two original empty reads used implicit Buenos Aires cutoffs, three hours later than intended, and are retained as invalid diagnostics. Correcting the original automated draft window finds six ordinary events, withdrawing the earlier no-ingestion claim; its recording-list miss alone remains an unsuccessful replay lookup.
    - [x] Verify deployed ordinary-event sensitive-query masking using the same two synthetic visits after ingestion delay: four BA events and eight Casamo events retain the harmless marker, replace q with <masked>, strip the synthetic URL fragment and omit referrers. Casamo covers both / and /trips/new; no new visit, form submission, model call or scan was made. The earlier zero-row reads remain failed/incomplete observations, superseded by actual stored payloads. Sessions: BA 01a13cc4-a1bf-75a3-89f8-bc21fff174ab; Casamo 01a13cbb-ca16-7aca-9338-20c2c9d47d79. Receipt: results/releases/url-query-delayed-read.json. Replay/network URL surfaces remain separate and unverified; historical data is not rewritten.
    - [x] Reproduce and locally fix the separate replay network URL gap in both apps. Existing synthetic recordings show their original q value and fragment in the network waterfall despite correctly masked ordinary events/start-URL metadata. Use the existing SDK maskCapturedNetworkRequestFn hook to remove all network URL query/fragment/userinfo, including document navigation; preserve status/timings, drop invalid/non-HTTP(S) URLs, and explicitly disable header/body recording. Page text, inputs and DOM attributes stay unmasked. Three focused regressions pass per app in both runners; application checks and 10 BA/18 Casamo spec checks pass. No SDK upgrade, new capture layer, model call or scan. Canonical specs and docs are aligned.
    - [x] Release and verify the replay network URL correction BA first, then Casamo. BA PR #13 merges at 932295e4c106a22f3535032ed20e17f54b517ce1, checked tree 13284da0a408ee53381ba1158e3b565a9a3cc2ab; native build 1c531ada-f94d-4bda-bd1e-0ff4e39683ad succeeds and public c5f40431-c730-41e4-8aa1-e7a808bab686 serves 100%. Stored recording 01a13ce3-73ff-7db1-a312-0c4bb5771e3a shows a clean network navigation URL and the unmasked harmless draft. Casamo PR #14 merges at 46406ce663b85c101d91d50565530eccbfb167f1, checked tree 37160f59ecc4aaa30c60ddd16d86a5c599db0ebd; GitHub browser run 38657537930 and native public build 9cfb8da5-f4d4-413c-8092-3177e158986e pass. Public 7efdb2da-d7a0-4d4c-a641-ec2f361ac104 serves 100%; recording 01a13ce9-a4ad-7ec0-8e14-9fecc14ce14f confirms the clean network navigation URL. Header/body recording stays explicitly off; DOM text/input/link attributes stay unmasked. Match by time/session rather than the stripped query marker; earlier empty marker reads were incomplete correlation, not failed capture. Staging public 90174fe7-469e-41cb-8582-719d18aab18b preserves audit PR #7 and passes signed-in page/navigation checks. Its absent PostHog project-token binding means no staging recording is expected. No new model or scan request, migration or historical rewrite. Per-project receipt: results/releases/replay-network-release.json.
    - Earlier settings read: both projects have recording enabled and configured 30-day retention; sampling is null, so its effective rate remains unverified. BA has no project masking override; Casamo exposes maskAllInputs=false. These settings do not prove recorded content or exact deletion timing. The original missing-scope and temporary-disconnection failures remain preserved in the access receipt.
  - [x] Fail closed when BA’s shared Supabase limiter errors, returns absent/malformed data or stalls beyond three seconds. Preserve known quota outcomes; distinguish outages with retry guidance in web/events/feedback, and verify Telegram’s existing 503/no-dispatch behavior. No extra rate-limit service or spending ledger. Twenty-eight transport/web/Telegram checks pass in both runners, plus an isolated real events-read/events-write/feedback route probe returning 503 before payload or backend work. TypeScript and 10 canonical specs pass. Preserve the existing signed recovery/commit stages’ original admission in the release branch; deployed outage testing remains open.
- [x] Rotate and revoke the original exposed BA Langfuse setup key; verify its replacement.
- [x] Revoke Casamo’s original app and first staging setup keys after owner confirmation. Only the privately saved app/staging replacements remain; the staging replacement verifies access to the separate Casamo project.

## 12. Release controls and reproducibility

- [x] Restore passing local tests, type checks, builds, and strict spec validation.
- [x] Commit and release BA Eventos tracing/evaluation changes; verify production web/Telegram execution. Deployed interruption, replay-payload and broader quality checks remain under their own sections.
  - [x] Pass the full existing release gate at runtime commit `e296a00`: 865 Bun and 850 Vitest tests, Svelte/TypeScript checks and production build, with no errors/warnings (86 Effect INFO messages). No new paid eval run. Private receipt: `results/releases/langfuse-current/gate.json` in the release checkout. Receipt-only documentation commits do not require repeating the runtime gate. At this local checkpoint, migration access, quality acceptance and deployed checks were open; subsequent migration/release receipts above record their later status.
- [x] Release Casamo Q&A removal and apply its deletion migration after backup.
  - [x] Merge PR #6 at `3f12f0f5522a40d29be96102d0c3330bbde576ed`, exactly matching checked tree `f92855e4e2e0996ccd9a60c3d03f946a0690aa63`. Final follow-up removes stale Q&A agent/iOS/readiness guidance and corrects supported D1 checks; inference code and frozen fixtures are unchanged. Native production builds `ffb1757f-813e-40a3-8b09-6a43a05d7719` (private) and `03bdacf4-84f9-492c-83a6-e5f2ec986a10` (public) deploy successfully, private first. After both Workers are released and active scans/Q&A are zero, apply the sole pending migration `0005_remove_trip_qna.sql`; all retired tables/triggers are absent. Users 6, credit ledger 77, scans 45, listings 203 and evidence artifacts 88,265 retain their pre-migration counts; quick_check is `ok`, foreign_key_check is empty. The previously verified production backup is rehashed successfully; all Q&A tables are empty before deletion. Update both Langfuse release identifiers to the merge revision; final 100% versions are private `de679480-3440-44c3-aaec-fee1c6a44f7c` and public `e8de5312-2be7-48b7-99d4-0f6c4eff444e`. Signed-in production trip `64dab092-0c2e-42b4-9ff9-a8e6861baee9` still shows its two stays with truthful missing prices, no Ask button, and favorite save/reload/restoration works. An initial five-second observation timeout is retained in the receipt; subsequent UI/reload establishes success without repeating the mutation. Main GitHub run `38605128187` passes. Private final receipt: Casamo `results/releases/qa-removal-production.json`; screenshot `qa-production-after-migration.png`. After deletion, repair forward or scope a Q&A restore from backup; old Q&A-aware Worker versions are not an automatic rollback.
  - [x] Deploy the checked Q&A removal tree `d6e604c40b6e02677502e2e4ff0b20e78a8ec849` to staging: private Worker `7e699fbf-4474-41d5-b030-29bf6f7509b0`, public Worker `72100b20-53de-4671-87d3-4708038824f1`. After both releases and zero active Q&A runs, apply `0005_remove_trip_qna.sql`. Verified private staging backup: 58,194,179 bytes, SHA-256 `b036797f6ec9624620d6a06b185669db8c28a006e626b6579dddea439cd86b10`. Retired tables/triggers are absent; users, credits, scans, listings and artifacts retain their exact pre-migration counts; D1 quick_check passes and foreign_key_check is empty. Signed-in saved trip still loads, Ask is absent, and favorite save/reload/restoration works. Receipts: Casamo release checkout `results/qa-staging-after.json`, backup checksum and deployment logs; primary Casamo `results/releases/qa-staging-after-migration.png`. Production release/deletion is still pending.
  - [x] Fix GitHub Actions before production promotion. Previous runs on main and both release branches failed only at anonymous trip entry because fixed check-in `2026-10-12` is now past. Test-only [PR #9](https://github.com/HanifCarroll/casamo/pull/9) generates valid future stays and is merged at `8660fd9b67c78287392352c9935970d35c298876`; all nine tests pass on the PR (`38603491764`) and [post-merge main run](https://github.com/HanifCarroll/casamo/actions/runs/38603971513). The same three-file fix is applied to PRs #6 and #7: both eight-test suites pass remotely in runs `38603435506` and `38603507683`. All eight Q&A-removal E2E tests also pass locally. Frozen report/evidence fixtures and application date validation are unchanged. Recent BA GitHub CI runs also pass. No tests, workflow triggers or failure notifications were disabled. Private receipt: Casamo `results/releases/github-actions-date-fix.json`.
  - [x] Prepare separate draft [Casamo PR #6](https://github.com/HanifCarroll/casamo/pull/6), stacked on tracing PR #5, at `d6aaafa`. Remove UI, browser/agent APIs, OAuth scope, Worker runtime/bindings, chat dependencies and Q&A-only artifacts. Existing D1 gets the unapplied `0005_remove_trip_qna.sql` after backup and both Worker releases; document the incompatible old-Worker rollback boundary. Application/Effect checks, 302 Vitest unit tests, 513 root native tests, 60 Cloudflare tests, 487 scan Worker tests, Worker typing and production build pass. Eighteen remaining specs validate with four pre-existing release archive INFO notices. Nineteen non-Q&A fixture/sample files are unchanged. No deployed removal or data deletion is claimed.
- [x] Release Casamo’s audit context-budget, title-translation and scan-profiler fixes with the owner-approved operational scope; independent quality remains open in Sections 2/7.
  - [x] Verify normal audit execution on staging after the separate resume correction. Scan `272d6a51-fb17-4509-a96c-54c3947e6d07` completes at 17:54:56Z with two saved stays and nonblank titles; notification-sent is recorded, inbox receipt unobserved. Four Langfuse observations across two successful review/photo model pairs carry staging, the audit release identifier, prompt/schema hashes and metadata-only counts/status. Recomputed configuration fingerprints match the new byte/token policy; reported input tokens including cache are 1,343 and 1,550. Current audit head `498f70d6afa7fbb99dca5ff0eb4044be3bb81e8d` matches tree `f8594d4859e08330734c2a8bcb6e1069a79afeb6`; CI `38610417433` passes. The budget and cache-repair failures remain deterministic-test evidence, not live fault injection. The profiler's live collector requires a separate configured Cloudflare API token, so no live CPU/profile result is claimed. Original evals/labels remain unchanged, monetary cost unknown, and independent review open. Private receipt: Casamo `results/releases/audit-reliability-staging.json`; screenshot `audit-staging-trip.png`.
  - [x] Record the owner operational checkpoint, merge and deploy PR #7. Explicit owner approval on 2026-10-15 UTC preserves the disputed photo label, six misses and independent review. Merge `4c352af391dff5c893b3f024bde904cd5c32e110` matches checked tree `fe8651b80e185c5aecd12ef04454fb9192d41aab`; all current-head and main browser/native gates pass. Native private build `8a852f0a-b000-4f76-8e64-5570609ea65d` deploys before public `e4ac9143-959a-4ea2-bb76-9160eca72e28`, with zero active scans before release. Final release-tagged versions are private `67cded0e-7ad9-4549-8dc8-b7d98843c2e2` and public `92feca6f-df1d-4923-aeda-5c5d362861ca`, both 100%. No migration. Rollback versions and exact checks are in Casamo `results/releases/audit-reliability-production.json`.
  - [x] Finish the single production smoke receipt for scan `94afd67e-9cba-490b-b2d2-0d1e62b6b4ce`, workflow `casamo-scan-59c86f8c-4fa0-4384-87e7-bb7961636791`. It completes at 01:05:23Z and records its completion notification at 01:05:31Z; the signed-in report renders two stays with nonblank titles. During the reported DeepSeek Flash partial outage, one photo and one review action each exhaust exactly three attempts and become unavailable; zero running attempts and zero resource permits remain. Twelve metadata-only observations contain six network-error generations, all with the expected production release and budget-policy configuration fingerprints. No fresh successful model response, returned context counters, failed-request spending, inbox delivery or independent quality is claimed. The real error alert reaches the email provider once. Original category=model diagnostic reads and the first failed traces remain preserved. No second scan, fault injection or quality rerun. Receipt: Casamo `results/releases/audit-reliability-production.json`; rendered report evidence: `results/releases/audit-production-report.txt`.
  - [x] Update audit PR #7 to the deployed parent at `88905ae2cc13b7c12afd0d93591f45a8259efaa5`, checked tree `750087d927a983fc968287bc612501499916feb0`. Current checks pass: 302 Vitest, 521 native root, 60 Cloudflare and 493 Worker tests, application/Effect/Worker checks, resumed public build and 18 strict specs/changes. Existing test results were retained across interruption; only the incomplete build resumed. Protected fixtures/sample are unchanged. Stage private version `963c003e-2162-417d-bc0e-c15e51fc29c7` and public `36087b3f-5e5e-4358-8534-bc1a5c3a6395` deploy in order; release identifiers are set to the published audit head. The owned two-listing request saves intent `8542724f-2210-41ae-8f14-0614d5d2f8c5`; staging account test access is then granted under the owner's prior 10,000-credit authorization. Its resume exposes the separate Section 9 access mismatch, so no new model scan has started and no cloud budget/trace result is claimed yet. PR CI run `38607721930` passes. Production remains pending.
  - [x] Prepare [Casamo PR #7](https://github.com/HanifCarroll/casamo/pull/7), stacked after Q&A PR #6. The release carries the aggregate 64 KiB/current-audit and observed 32,768-token guards, title-translation recovery and unknown provider totals in the profiler. Repair historical blank cache rows without replacing a concurrent valid translation; preserve row/source identity and creation time. Full checks pass at runtime `d2bf2b7`: 302 Vitest, 521 native root, 60 Cloudflare and 492 Worker tests, application/Effect/Worker types and production build. Test/spec-only follow-up `ec19aaf` adds a passing concurrent-writer regression; seven actual SQLite/title-cache checks pass and 18 specs validate. Nineteen remaining fixture/sample files are unchanged. Budget policy participates in trace configuration identity. Original quality failures/labels, initial token overshoot, staging and deployment remain explicit limits.
- [x] Implement the explicit manual AI-release decision gate and consolidate reproducible receipts locally; publishing and independent quality approval remain separate below.
  - [x] Add a short manual owner checkpoint and PR template to both projects, using the existing tests and frozen eval reports. Define the receipt fields and rollback references without adding a CI platform or harness. This documents a merge checkpoint; it does not enforce branch protection or establish current-head quality.
  - [x] Consolidate the existing recorded operational releases into per-project `results/releases/ai-reproducibility-20261015/index.json`: eight BA artifacts and 23 Casamo artifacts, their SHA-256 fingerprints, original release/check/deployment/rollback records, model/configuration evidence, corpus/results and explicit historical unknowns. The current Booking run additionally saves exact local source plus lockfiles and the selected/returned model, prompt/schema hashes, 18 frozen photos and six provider responses. No new release/full gate or retrospective quality approval is implied.
  - [x] Update both local PR templates and release checklists to require one supported decision: reviewed quality accepted; no AI behavior change; release-specific owner-approved operational exception; or blocked. Owner-deferred review is not a passing grade or standing waiver. Retain Casamo PR #7's explicit operational acceptance and its original photo failures.
  - [x] Publish the release-checkpoint and PR-template changes through BA PR #14 and Casamo PR #16 after the owner explicitly requested pushing and merging on 2026-10-15. These are documentation-only releases with `no_ai_behavior_change`; merge/build outcomes and safe branch/worktree cleanup are retained privately in each project’s `results/releases/publishing-20261015/`. Independent quality review remains owner-deferred.
  - [ ] Obtain independent quality acceptance before claiming a reviewed-quality release gate has passed (owner-deferred; operational receipts remain complete in their stated scope).
- [x] Record code, prompt, model, configuration, corpus, results and rollback evidence in the per-project fingerprinted indexes; preserve unreported historical fields as unknown rather than inventing them.
- [x] Reconcile four informational Casamo spec archive notices before archiving changes; also reconcile the later reuse/freshness notice while preserving all three current scenarios (strict validation is clean).

## Verification receipts

- Casamo staging recovery checkpoint: the approved temporary Service Auth credential unblocks the existing canary without changing production access. One run `recovery-20261014` proves scheduled stranded-outbox reconciliation, confirmed expired-dispatcher-lease recovery with stale-version rejection, and reconciliation of a seeded ambiguous state. All three retain envelope/downstream identity and clear leases. Completion is 2026-10-14T23:50:33.675Z; scoped cleanup removes the three cases and their associated synthetic operations/confirmations/audit/ledger records, verified at 23:51:14.022Z. No email/model calls or application release occurred. Duplicate delivery, stage-lease loss and real network ambiguity remain unverified. Private receipt: Casamo `results/releases/staging-recovery-canary.json`; credential expires after 24 hours and is stored only in ignored `.env.staging`.

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

- Section 11 content policy checkpoint (2026-10-14): the owner's chat/tool-content
  policy is implemented as export-only redaction. Six focused checks pass in both
  runners in the release checkout; TypeScript passes in primary and release. The
  actual AI SDK/default OTLP loopback receipt
  `results/langfuse/redaction-probe.json` records three mocked generations, zero
  external provider requests, retained useful text and unchanged app outputs.
  Ten release specs validate. Production payload/access/retention checks remain
  open. Casamo's query/referrer configuration is pushed; shortening its privacy
  requirement resolves the new length warning (18 primary/19 release items pass,
  with the release's four existing archive INFO notices retained).

- Casamo staging setup checkpoint on 2026-10-14: normal recipients are enabled by removing only the staging queue allowlist, with canonical identity spec and runbook aligned; the synthetic seed and operator test address remain unchanged. Commit `83183176fd50e3e121f92ecb181c8da64ba86547` has the tested email change. Scan Worker version `803ad9d7-921c-4296-abba-5bcffb978ac7` includes the staging-only credentials; public counterpart `5a3d4576-3cf6-442b-ac58-0d7eea5706cc` is deployed. Worker types and 527 tests, 19 spec/change validations and packaging pass. Current release gate passes application/Effect/boundary checks, 303 Vitest and 532 native root tests; Cloudflare has 77 passes, six skips and one 5-second SDK timeout, whose isolated retry passes. Production build passes separately; do not describe the original aggregate command as clean. No paid eval rerun or production deployment. First live submitted-listing scan `b07dbf17-b89c-48fb-a802-9405bfc17f8e` fails before model execution: source attempt `booking_submitted_unavailable`, followed by submitted-property coverage failure. Credit restoration and notification-sent fields are recorded; inbox receipt is unobserved. Schema matches the migration; an incorrect diagnostic column query was corrected, with no schema write. The second two-listing Airbnb scan `ccf871fe-ad6c-4228-8eb4-acc2f40bdc84` completed at 16:01:50Z and saved both listings, with uncaptured dated prices shown honestly. Twelve cloud observations across six audit/model trace pairs verify staging, action/scan correlations, prompt/schema hashes, configuration IDs, usage and metadata-only input/output. Terminal notification-sent is recorded; inbox delivery remains unobserved. Private receipt: Casamo `results/releases/staging-release.json`. Private receipts remain in Casamo results/releases and the release worktree results/langfuse-release.

- Casamo tracing release checkpoint: PR #5 merged at `886f2811b2b5471e8a41a8bbac1c641865e17c37` after the completed staging scan and metadata-only cloud export. Production deployment is not yet observed. Updating production secret annotations during the build was rejected because a newer Worker version was uploaded but not active; no secret change was applied. Existing app credentials remain configured. The CLI credential can read deployments but receives HTTP 403 for Builds reads; use the signed-in dashboard rather than expand its access.

- Casamo production follow-up: private build `c15d72ad-fb4f-4e85-baca-0c626d53f044` succeeds on tracing merge `886f281`; public build `8e6a1389-2439-4b37-9aaf-47bef6bab288` reproduces the five-second real-SDK test timeout. Test-only PR #8 gives that integration test 15 seconds and is merged at `aacdcb8893f7ca9ffaa58563735820d83125aff0`; all seven Cloudflare files pass (78 tests, six existing skips). Production deadlines and assertions are unchanged. A full private pre-Q&A-removal D1 export completes (132,653,985 bytes; SHA-256 `c6038ad1332ac00e067092037e82ead7d2c92cabed8ede096388290fab31a213`), with deletion still unapplied. Owner explicitly authorized 10,000 credits for the account used for checks: one idempotent admin_adjustment ledger row is applied through owner-authorized D1 maintenance and a one-year pass window makes them usable. The actual production Account page verifies 10,000 searches and active access through 2027-10-14. Private receipt: Casamo `results/releases/test-credit-grant.json`. One two-listing production canary is now running; count it as setup traffic, not independent product-quality or real-user satisfaction evidence.

- Casamo tracing production release is complete: public Worker `23162822-b569-4292-a0c9-e66167cdd01f` and private Worker `2bf43a31-3eb8-4fab-b584-33830b1861f7` are active at 100%. The private native build succeeds; public deployment uses the existing manual path with the verified bundle because configured build watch paths exclude test files and do not trigger the one-line PR #8 fix. The checked local tree equals current main `f392efd7af7dc8fad4443e96a350803e6feba7ca`. Production scan `64dab092-0c2e-42b4-9ff9-a8e6861baee9` completes and saves both listings, with notification-sent recorded and inbox receipt unobserved. Six observations across three review/photo model/audit pairs carry selected model, usage, prompt/schema hashes, configuration and action/session identifiers; inspected payloads contain counts/status and exclude source URLs. Monetary cost remains unknown. One authorized test search leaves 9,999 credits. Private final release/rollback receipt: Casamo results/releases/production-release-final.json. This is setup verification; independent quality, effective browser replay, sampling/access/retention and deployed interruption checks remain open. The verified backup supports the still-unapplied Q&A deletion migration; no deletion is claimed.

- Casamo final account read: after one HTTP 400 on the first account navigation following public deployment, the account API and fresh SSR Account page both return the expected 9,999 credits and active-through 2027-10-14 window. The initial error is retained in the private receipt; its cause is unconfirmed and no application patch was made. Q&A removal, its deletion migration and the separate audit-reliability release remain pending with the verified backup ready.

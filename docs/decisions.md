# Architectural Decisions

This document tracks important architectural decisions made during development.

Newest decisions appear first.

## Template

When adding a new decision, use this format:

```
### [Brief Title]

**Date:** YYYY-MM-DD

**Decision:** What was decided

**Alternatives Considered (if applicable):**
- Alternative 1: Why it was rejected
- Alternative 2: Why it was rejected

**Rationale:** Why this approach was chosen
```

---

## Decisions

### Generic prefer-facet rerank and default 3-item discovery limit

**Date:** 2026-08-15

**Decision:** `search_events` now soft-reranks results by facet overlap against the canonicalized `prefer` hints (genres, vibes, activities, audience, setting) instead of only reranking chill asks. `prefer` is populated from both `input.prefer` and whole-token extraction from the free-text query, merged per key. Chill keeps its existing scorer and wins when `detectChillIntent` fires; otherwise a non-empty prefer runs `preferRerank` (overlap count, stable, never drops). Vague discovery asks with no explicit limit, no surprise objective, and no named must (neighborhood/venue/category/free/price/age/date) now default to a display limit of 3 instead of 1.

**Alternatives Considered (if applicable):**
- Reuse `chillRerank` scoring for all prefer dimensions: rejected — chill's energy/eventType weights are chill-specific and would distort genre/vibe boosts.
- Keep the default display limit at 1 and let the model always set 3: rejected — the model under-specified limits on discovery asks, so "what's on tonight" returned a single pick.

**Rationale:** Prefer was already carried on the intent but only joined into retrieval text; the reranker comment promised a boost that never shipped. A generic overlap boost generalizes the existing soft-rerank without making prefer a hard filter, and a discovery default of 3 matches the concierge's list intent for time/vibe asks.

### Happening soon grid; rolling 12h floor

**Date:** 2026-08-15

**Decision:** Rename the home grid from "trending" to "happening soon" in code, i18n, analytics, and the chat pin field (`happeningSoonEventId`). The query floor is now + 12 hours from request time, not next 6 PM Buenos Aires.

**Alternatives Considered (if applicable):**
- Keep `trending*` identifiers because the UI already said "Happening soon": rejected — the name leaked into APIs and analytics.
- Keep the 6 PM nightlife gate and only rename: rejected — a 2 PM visit should still see events 12+ hours out, including daytime ones.

**Rationale:** The grid was never popularity-ranked. A rolling 12h floor matches the label and stops hiding afternoon events or a night that has not started yet.

### Adaptive thinking on chat; facets on search RPCs

**Date:** 2026-08-15

**Decision:** Concierge `streamText` uses DeepSeek `thinking: { type: 'adaptive' }` (`CHAT_THINKING`). Structured calls keep `NO_THINKING`. The finished answer is still guarded, then emitted as 24-char `text-delta` chunks so the bubble types instead of appearing all at once. Reasoning tokens stream live as muted text above the answer. Both `match_events_with_venues_filtered` and `lexical_match_events_with_venues` now return `e.facets` so `chillRerank` can score hybrid hits.

**Alternatives Considered (if applicable):**
- `enabled` + `reasoningEffort: high` on chat: rejected as the first step — slower and more expensive before we know adaptive is insufficient.
- Stream unguarded model tokens: rejected — off-topic and coverage guards still need the finished answer.
- Join facets in app code after hybrid: rejected — the RPC already has the column; returning it is one migration.

**Rationale:** Saturday "next weekend" needs a thinking step; extract/categorize do not. Chill ranking was a no-op because hybrid results omitted a column that already existed on `events`.

### Semantic external event actions (desktop card CTA)

**Date:** 2026-08-14

**Decision:** External event CTAs are derived from the import source, not from `ticket_url`. `src/features/events/lib/source-presentation.ts` exports `getExternalActionKind` (passline/eventbrite/venti → `tickets`, meetup → `rsvp`, luma → `register`, everything else → `source`), `getExternalLinkType`, and `getExternalActionLabel`; the desktop event card and the event detail page share them. The desktop default card was redesigned from an expanded-accordion surface into a flat divided row (DM Sans, no card chrome, labeled actions only — no icon tooltips) per DESIGN.md.

**Alternatives Considered (if applicable):**
- Keep deriving the CTA from `ticket_url` presence: Rejected — importers store the plain event/source page in `ticket_url` for Meetup, Luma and BA Tourism, so "Get tickets" was wrong for those sources.
- Sniff the URL host to guess the action: Rejected — source is already canonical on the event row and covers future sources; URL hostnames change.

**Rationale:** `ticket_url` is not semantic (all six transformers mirror the event page into it), so the source string is the only reliable signal. Reusing one helper in both surfaces keeps labels and analytics `link_type` (`ticket`/`rsvp`/`register`/`source`) consistent. Related Decision: Surprise-me and list diversity (2026-08-14).

### Surprise-me and list diversity (Phase 9)

**Date:** 2026-08-14

**Decision:** Added `objective: 'surprise'` to `search_events`. When triggered (explicitly, or derived when there is no semantic query and the `must` set is only the default upcoming window), the tool ranks the filtered upcoming set (cap 50) with a deterministic quality + near-term-decay scorer and returns one event — no longer "the soonest event." For lists (`displayLimit > 1`) on both the filter-only and semantic paths, a greedy order-preserving diversity pass caps 2 events per venue and 3 per identical categories signature, filling from remaining ranked candidates.

**Alternatives Considered (if applicable):**
- Make surprise return multiple options: Rejected — a decisive pick is one event, and surprises shouldn't read as a discovery list.
- Apply quality to the semantic path's relevance order: Rejected — quality must not leak into "is this a good semantic match." Diversity only drops over-capped events on lists, preserving vector/RRF order.
- Track "already shown in this conversation" to avoid repeats: Deferred — the tool context carries no event ids, so we skip rather than invent session state.

**Rationale:** Addresses the live `eval:search` gap where retrieval tops are the right *kind* of current event but surprise-me was just the soonest scheduled event. A quality/soonness pick and venue/category diversity give better surfacing without compromising semantic relevance. Quality scoring uses image / `!location_tba` / `!description_unavailable` / has-venue; soonness is an exponential decay over ~2 days (not a hard "soonest"). Related Decision: Vibe Search (2026-08-14, superseded).

### Removed vibe scorer

**Date:** 2026-08-14

**Decision:** Constrained semantic retrieval is the only search path. The phrase-table scorer is deleted.

**Related Decision:** [Constrained Semantic Retrieval] (2026-08-14).

### Constrained Semantic Retrieval

**Date:** 2026-08-14

**Decision:** Vibe phrase-scoring is a temporary comparison path behind `SEARCH_VIBE_PATH`. Retrieval becomes must-filter → dense+lexical → RRF → optional LLM rerank → quality/diversity. String matching is limited to alias canonicalization.

**Alternatives Considered:**
- Keep expanding `vibe-search.ts`: rejected — a second incompatible engine, false positives, unmaintainable.
- Embeddings-only with limit=1: rejected — the retriever is not a ranker.
- Dedicated intent-extraction LLM on every request: deferred until the expanded tool schema fails.

**Rationale:** One retrieval method should not be asked to return the final answer directly. The plan is a staged migration (see `docs/constrained-semantic-retrieval-plan.md`) that keeps today's behavior default-on behind `SEARCH_VIBE_PATH` while the new pipeline lands phase by phase.

**Related Decision:** [Vibe Search: Deterministic Scorer Over Hard-Filtered Candidates] (2026-08-14).

### First-Message Handoff: Immediate Render, Off-Path Persistence

**Date:** 2026-08-14

**Decision:** Reworked the home-screen → `/chat/:id` first-message flow so the submitted message renders on the first frame of the remounted instance and nothing blocks the navigation. The parked first message (ChatProvider) is now peeked non-destructively at mount and rendered optimistically until `sendMessage` appends the real one; the full-pane conversation spinner and "not found" states are suppressed while a handoff is pending. Guest conversation creation is fire-and-forget — the IndexedDB write no longer sits on the navigation path, the guest-detail query cache is seeded synchronously before navigating, and IndexedDB read/write failures degrade to an in-memory chat (logged) instead of blocking or erroring the UI. The composer locks on both instances (home submit lock + parked-message lock) to prevent duplicate submission. Streams still only ever start from the mounted `/chat/:id` instance — never from the unmounting home instance. A `chat:first_message_handoff` event breaks down persistence, navigation/remount, pending-message consumption, request start, first response, and completion.

**Alternatives Considered:**
- Streaming from the home instance before navigation: rejected — the component unmounts mid-stream and the response never renders (the original bug class).
- Awaiting IndexedDB before navigating (previous behavior): rejected — a slow/failing IndexedDB write blocked the submit and the first paint.
- Keeping the optimistic message only in provider state without a render peek: rejected — the first frame after mount would still show the spinner/empty state.

**Rationale:** The navigation remount is inherent to the URL-per-conversation model; the fix makes the handoff invisible (message visible immediately, spinner never shown) and persistence a background concern with a seeded cache as the source of truth for the first paint. Hydration/LCP work stayed out of scope.

Related Decision: [Fix New Chat Message Sending] (2026-08-06) — superseded for the first-message path.

---

### Vibe Search: Deterministic Scorer Over Hard-Filtered Candidates

**Date:** 2026-08-14

**Decision:** Added a structured vibe scorer (`src/features/chat/api/tools/vibe-search.ts`) as a second retrieval path inside `search_events`. Vibe queries — detected by bilingual (en/es) signals for chill/tranqui, techno, energetic/party, free/gratis, date-like, plus geo/time signals (named neighborhood, weekday, today/tonight/tomorrow/weekend) — are ranked in memory over the hard-filtered candidate set. The candidate fetch is capped at `VIBE_CANDIDATE_CAP = 1000` (Supabase's default response limit): exhaustive for the current small corpus, and a documented bounded safeguard if the matching corpus ever exceeds that limit (no paging implemented — revisit when the corpus approaches it). Scoring combines keyword overlap (name-weighted), intent-signal soft boosts/penalties, neighborhood/day/time context boosts, and completeness quality adjustments. The relevance gate is strong-evidence only (keyword overlap + text/free-flag signal matches ≥ `MIN_CONTENT_SCORE`); category nudges rank but never qualify. Results are capped at the requested limit and may be FEWER when relevance is poor — a corpus that does not fit the ask yields a short or empty list, never filler. Query-named neighborhoods exclude events known to be elsewhere. Non-vibe queries keep the existing `hybridEventSearch` semantic path. No hybrid fusion, RRF, or LLM retry pipeline was built.

Also fixed server search telemetry: `agent:tool_used` now reports the REAL tool success (was hardcoded `true`), and each search emits a dedicated `search:executed` event (query, filters, `search_mode`, counts, duration, success).

Added a reusable labeled bilingual evaluation set (`evals/search/vibe-golden.ts` + deterministic fixture corpus `vibe-fixtures.ts`, runner `vibe-run.ts`, `bun run eval:vibe`) covering chill/tranqui, techno, free/gratis, date-like/cita, neighborhood, and tonight/today-signal searches, plus vitest coverage in `vibe-search.test.ts` and `search-events.test.ts`.

**Alternatives Considered:**
- Routing all queries through embeddings: rejected — embeddings are blind to free-vs-paid, neighborhood, weekday, and chill-vs-techno structure, and the corpus is small enough for exhaustive in-memory scoring.
- Hybrid fusion / RRF over semantic + lexical: rejected (explicitly out of scope) — adds tuning complexity for a small corpus where the deterministic scorer already isolates the relevant signals.
- LLM-based re-ranking: rejected (explicitly out of scope) — latency and cost per search with no accuracy need at this corpus size.

**Rationale:** Deterministic, pure, testable scoring matches the small-corpus reality: the hard filters already shrink the candidate set, and the labeled eval set pins the bilingual behavior permanently (no DB staleness).

---

### Vite 8 Unblocked via Dev-Middleware Workaround

**Date:** 2026-08-11

**Decision:** Adopted Vite 8.2.1 + @vitejs/plugin-react 6.0.5 with `tanstackStart({ vite: { installDevServerMiddleware: true } })` in `vite.config.ts`. This forces the SSR dev middleware to install, bypassing the faulty `"dispatchFetch" in serverEnv` guard that silently skips it on Vite 8 (TanStack/router#7614, open). The secondary `instanceof RunnableDevEnvironment` guard passes on single-Vite installs like this repo.

**Alternatives Considered:**
- Pinning Vite 7 (the issue's recommended workaround): worked, but leaves us two majors behind and blocks plugin-react 6.
- Patching `@tanstack/start-plugin-core` via `patchedDependencies`: durable but adds a node_modules patch that must be re-validated on every TanStack bump; the config flag achieves the same result with zero patch surface.

**Rationale:** Config-only, removable when the upstream fix ships (the flag's own doc says it loses its value once the guard is fixed). Verified: dev SSR serves 200 on `/` and `/login`, 307 auth redirect on `/saved`, process stable; production build, tsc, and all 77 tests pass.

Related Decision: [TanStack Family Upgrade; Vite Held at 7] (2026-08-11) — superseded by this entry.

---

### PWA via Custom Workbox Plugin (Not vite-plugin-pwa)

**Date:** 2026-08-11

**Decision:** Implemented PWA support with a custom Vite plugin (`pwaWorkbox` in `vite.config.ts`) that runs `workbox-build` `generateSW` against `dist/client` on the client environment's `closeBundle`, plus manual SW registration and manifest linking in `__root.tsx`. SW precaches hashed assets and runtime-caches HTML navigations (NetworkFirst) and Google Fonts. `public/manifest.json` gained `id`/`scope`/`lang`, a maskable icon, and theme colors aligned to the actual light UI.

**Alternatives Considered:**
- vite-plugin-pwa: build steps never execute under TanStack Start's multi-environment build (TanStack/router#4988, still open; fix PR unmerged). The documented workaround requires SPA mode, which would remove SSR.
- Serwist (vite-plugin-pwa fork): same upstream bug.

**Rationale:** workbox-build is the engine under vite-plugin-pwa anyway; a ~40-line plugin is deterministic and unaffected by the upstream issue. No static `index.html` exists (runtime SSR via Netlify function), so offline support is precache + runtime navigation caching rather than an app-shell fallback.

### TanStack Family Upgrade; Vite Held at 7

**Date:** 2026-08-11

**Decision:** Upgraded `@tanstack/react-router` 1.144.0 → 1.170.25, `react-start` 1.144.0 → 1.168.42, `router-plugin` → 1.168.29, `react-router-ssr-query` → 1.167.1. Removed the `as any` cast from the `/api/chat` route id (plugin now requires a string literal) and migrated all 17 `inputValidator()` callsites to the renamed `validator()`.

**Alternatives Considered:**
- Vite 8.2.1 + @vitejs/plugin-react 6.0.5: production build succeeds, but the dev server crashes (H3Event constructed with an undefined URL in the streaming batch flush — TanStack/router#7614 class of bug). Rejected until upstream fixes dev-mode Vite 8 support.

**Rationale:** latest TanStack declares `vite >=7`; keeping Vite 7.3.6 preserves a working dev loop. Revisit Vite 8 when TanStack ships the dev-server fix.

### Netlify Node 24; TypeScript 6 (7 Blocked Upstream)

**Date:** 2026-08-11

**Decision:** `NODE_VERSION` 20 → 24 in `netlify.toml` (Node 20 reached EOL 2026-04-30; Netlify's default is now 24). `@types/node` 22 → 24 to match the runtime. TypeScript 5.9.3 → 6.0.3.

**Alternatives Considered:**
- TypeScript 7.0.2 (native Go compiler): `tsc --noEmit` passes, but `vite build` crashes — `@netlify/zip-it-and-ship-it` → `precinct` → `detective-typescript` → `@typescript-eslint/typescript-estree` reads `ts.Extension.Cjs` at module load, an enum TS 7 removed. The programmatic API returns in 7.1; Netlify's bundler hasn't migrated. Rejected until then.

**Rationale:** TS 6 is the bridge release with the full compiler API intact; the upgrade from 5.9 required zero code changes.

### Supabase SSR 0.12 (Auth Cookie Headers)

**Date:** 2026-08-11

**Decision:** Upgraded `@supabase/ssr` 0.8.0 → 0.12.4. No callsite changes needed (getAll/setAll shape already in use); extended the server client's `setAll` to apply the cache-control headers the library now passes, preventing CDNs from caching auth-cookie responses (one user's session served to another).

**Rationale:** 0.12 changed `setAll(cookies, headers)` semantics; applying the headers is required for safe auth behind Netlify's edge CDN.

---

### Remove All Admin UI (Agent-Only Operation)

**Date:** 2026-08-10

**Decision:** Removed the entire admin UI — events admin, venues admin, scraping dashboard, venue review queue, blocklist admin, and the `/admin` route shell — plus every admin-only server function and hook that backed them. The site is operated exclusively through agents (automated Trigger.dev pipeline + agent scripts), so the admin screens and their server actions are dead weight.

**Problem:** After the import wizard removal (see below), the remaining admin surface (~55 files) served no operator: events/venues CRUD tables, bulk actions, enrichment buttons, scrape monitoring, venue review, and blocklist management all duplicated capabilities agents exercise directly against the database (service-role client), the shared core pipeline, and Trigger.dev jobs.

**Removed:**
- Routes: `/admin`, `/admin/events*`, `/admin/venues*`, `/admin/scraping*`, `/admin/blocklist*` (plus the admin nav in `MainLayout`; login/auth-callback redirect to `/` instead of `/admin`)
- Hooks: events bulk/single-action/mark-past/mutations/paginated hooks, the 5 description-enrichment hooks + strategy map, venues review/enrichment/mutations/bulk hooks, `useTriggerEnrichment`, `useBlocklistMutations`
- API: `events/api/crud.ts` admin actions (rewritten to the 2 public actions: `getTrendingEventsAction`, `getEventWithVenueAction`), `events/api/{enrichment,moderation,stats,queries,streaming-types}.ts`, `venues/api/{crud,review,enrichment}.ts` (whole venues feature — chat venue tools use `shared/lib/db/client` directly), `import/api/scrape-runs.ts`, `import/api/blocklist.ts`, the per-source enrichment actions in `import/api/{passline,eventbrite,ba-tourism,meetup,luma}.ts` (admin-button-only), `import/api/trigger-enrichment.ts`, the three feature barrels' dead exports (`features/import/index.ts` deleted entirely, `features/venues/index.ts` deleted, `features/events/index.ts` reduced to the 2 public actions), `shared/ui/data-table/` (admin-only), `shared/ui/EmptyState.tsx`, `shared/lib/admin-utils.ts`
- Kept: `import/core/venue-review.ts` (NEW — approve/reject/merge logic moved from the deleted review UI so agents can still settle the queue), the entire automated pipeline (`core/*.ts`, `scrapers/*`, enrichment adapters, Trigger.dev jobs), `getBlocklistEntries` (pipeline), and all public routes/chat.

**Rationale:** Agents are the only operator and already use the same data paths the admin UI wrapped (DB, core pipeline, trigger jobs). Removing the UI eliminates ~55 files and their server functions without losing any capability.

**Verification:** `bunx tsc --noEmit` clean; route tree regenerated with zero admin routes; public site serves (`/` 200, `/login` 200, `/saved` auth-guarded, `/event/$id` works); the daily Trigger.dev pipeline is untouched.

**Related Decision:** "Remove the Admin Import Wizard" (2026-08-10).

---

### Remove the Admin Import Wizard

**Date:** 2026-08-10

**Decision:** Removed the manual admin import wizard — the `/admin/events/import` 7-step UI (Source → Configure → Venues → Select → Confirm → Enrich → Summary), CSV import, and the per-source fetch/import/process server actions and SourceAdapters that backed it.

**Problem:** The wizard was a parallel manual path to the automated Trigger.dev daily scrape. The site has a single operator who drives imports through agents (the daily jobs), so the wizard's ~15 UI/hook files and per-source server actions were dead weight — and they duplicated thinner versions of pipeline logic (venue matching, dedupe, embeddings, enrichment) that `core/*.ts` already owns.

**Removed:**
- `routes/admin/events/import.tsx` + `-components/import/*` (8 step components)
- `hooks/useImport*.ts` (wizard + sub-hooks), `useAutoEnrichment.ts`, `hooks/helpers/`
- `adapters/*-adapter.ts` (per-source SourceAdapters) + the SourceAdapter registry in `adapters/index.ts`
- The `fetch*`/`import*`/`process*` server actions and `*PreviewEvent` types in `api/{passline,eventbrite,ba-tourism,meetup,luma}.ts`
- `shared/ui/data-table/columns/import-columns.tsx` and `lib/source-metadata.ts`
- The "Import" button link on the events admin page

**Kept (shared with the live pipeline / admin buttons):**
- `core/*.ts`, `scrapers/*`, and all Trigger.dev jobs (the daily scrape)
- The enrichment adapters (`adapters/enrichment/*`), consumed by the daily enrichment job via `getEnrichmentAdapter`/`hasServerEnrichment` — their client-side `extractDescriptions`/`extractVenues`/`getEnrichmentUrl` (wizard-only) were removed
- The `enrich*VenuesAction` (used by the venues admin `useVenueEnrichment`) and `enrichLumaDescriptionsAction` (events admin "Add Descriptions")

**Rationale:** Agents are the only operator; the automated pipeline supersedes the manual wizard and reuses the same source data. Removing it eliminates a large surface of duplicated, aging logic without touching the pipeline or the still-used admin enrichment buttons.

**Verification:** `bunx tsc --noEmit` clean; route tree regenerated (import route removed); dev server serves the admin pages normally.

**Related Decision:** "Venti as a Sixth Automated Scrape Source" (2026-08-10), "Generic Translate-Only Enrichment" (2026-08-10).

---

### Passline Automated Scraping via Browserbase

**Date:** 2026-08-10

**Decision:** Re-enabled Passline as an automated scrape source by routing its API request through a Browserbase cloud browser session.

**Problem:** Passline's Cloudflare protection blocks plain server-side HTTP fetches to `api.passline.com`, which had kept Passline out of the automated Trigger.dev pipeline (see "Passline Trigger.dev Playwright Attempt (Failed)", 2026-01-25).

**Investigation:** The 2026-01-25 failure was IP/infrastructure-based — Browserless.io and Trigger.dev Playwright egressed from datacenter IPs that Cloudflare blocks. Browserbase sessions egress through a managed proxy network (residential IPs) with captcha solving, which is designed to defeat exactly this kind of IP-based blocking. A live CDP test that ran the `GetCountryByBillboardHome` POST inside a Browserbase session confirmed the API returns HTTP 200 with ~2,700 events — Browserbase bypasses Passline's Cloudflare.

**Solution:**
1. Added `scrapers/passline/browser-scraper.ts` — runs the Passline API POST inside a Browserbase session via `page.evaluate`, mirroring the Meetup scraper.
2. `core/passline.ts` now uses the Browserbase path when `BROWSERBASE_API_KEY` is set, falling back to plain HTTP (dev).
3. Added the `scrape-passline` Trigger.dev job and restored Passline to `daily-scrape.ts` (30 days ahead, matching Eventbrite).

**Alternatives Considered:**
- Local Playwright / Playwriter: Rejected for the automated job — needs a user's real browser; Browserbase is headless and server-side.
- Continuing manual-only Passline import: Rejected — misses events between admin runs and breaks the single automated pipeline.

**Related Decision:** Supersedes "Passline Trigger.dev Playwright Attempt (Failed)" (2026-01-25) and "Disable Scheduled Passline Scraper" (2026-01-11).

---

### Venti as a Sixth Automated Scrape Source (Niche Bar/Club Events)

**Date:** 2026-08-10

**Decision:** Added Venti as an automated scrape source via its public API (`api.venti.live`), wired into the daily Trigger.dev orchestrator alongside the other 5 sources.

**Problem:** The bar/club/fiesta nightlife scene — "Bresh", "Niceto Club", "BlackCream", electronic music parties — was under-represented. Existing sources (Passline, Eventbrite, Meetup, Luma, BA Tourism) skew toward structured ticketed, cultural, and community events. Venti is the dominant ticketing platform for this niche scene in Argentina, and had no importer.

**Investigation:** Browser DevTools inspection of `venti.live` revealed the SPA calls `api.venti.live`. Verified via plain server-side GETs (no auth, no browser, datacenter IP):
- `GET /api/event/search?limit=200&page=N` — full catalog with **Spanish descriptions**, `category`, `startDate`/`endDate`, and venue (name, address, lat/lng, Google Place ID). 314 events total, 179 in CABA (`venue.cityId === 1`). CORS is open (`access-control-allow-origin: *`); no bot protection observed.
- `GET /api/event/urlName/<slug>/ticketType/availability` — `minTicketPrice` (ARS) + free flag, per event.
- `GET /api/event/detail/urlName/<slug>` — Producer/org name (e.g. "Niceto"), artists.

**Solution:**
1. `scrapers/venti/` (types, api, transformer) — catalog fetch with pagination, CABA filter, availability batch fetch.
2. `core/venti.ts` — full pipeline: fetch → CABA + blocklist → availability → venue settle → dedupe → transform → categorize → embed → upsert.
3. `trigger/jobs/scrape-venti.ts` + registration in `daily-scrape.ts` (SOURCE_JOBS + trigger call).
4. Native category mapping (`party→social`, `concert→music`, `festival→festival`, `gastronomy→food`) — the AI categorizer runs only for events with unknown categories (10 of 178 on first run).
5. Enrichment strategy `none` — descriptions arrive natively in the catalog, so no Jina/LLM extraction phase is needed.

**Alternatives Considered:**
- quehacemos.com.ar as an aggregator source: Rejected as the primary — it aggregates Venti (its API even labels events `source: "venti"`) but adds a parsing layer and JS-hydrated pages; Venti direct is the source of truth.
- Instagram scraping: Rejected — no public API for third-party orgs, auth walls, ToS risk.
- Direct venue-site crawling: Rejected — BA bar/club sites rarely expose structured feeds (probed Niceto, Konex, Matienzo, La Tangente, Bresh — none publish iCal).

**Rationale:** Venti is the direct source of the target niche, and it is the cheapest scrape in the pipeline: 2 requests cover the full catalog, descriptions and venue coordinates come free in the listing (best venue input of any source — coordinates + Google Place ID feed `venue-settlement.ts`), and it needs no browser, proxy, or per-event detail fetches.

**Consequences:**
- Field coverage verified across the 178 CABA events: 100% for name, dates, venue, categories, price flag, image, links, external_id, embedding; 93% price; **78% (138/178) have `description_es`** — the remaining 40 have no description in Venti's own API (a source data limitation, not a scrape gap).
- Prices are raw ARS with no conversion.
- Venti's `minTicketPrice` is in cents (hundredths of ARS, like Luma) — the transformer divides by 100 before storing (e.g. `1500000` → `15000` ARS).
- The public consumer API could gain auth/bot protection later; Browserbase (Passline path) is the contingency.

### Generic Translate-Only Enrichment (es → en for native-description sources)

**Date:** 2026-08-10

**Decision:** Added a generic translate-only fast path to the shared event enrichment pipeline (`src/features/import/core/event-enrichment.ts`): when an event already has `description_es` but no `description_en`, enrichment now translates `es → en` directly instead of re-scraping the source page via Jina Reader.

**Problem:** Every source that ships descriptions natively (BA Tourism, Eventbrite, and now Venti) inserts `description_en: null` and relied on the post-import enrichment phase to produce English by re-fetching the source page (Jina Reader + LLM extraction). This is redundant for events that already have a Spanish description, and it fails on JavaScript-heavy SPAs (e.g. Venti) that Jina cannot parse. The result was that English descriptions for these sources depended on a fragile re-scrape.

**Solution:**
1. `getEventsNeedingEnrichment` now selects `description_es` / `description_en` alongside the other fields.
2. `EventEnrichmentInput` gained `description_es` / `description_en`.
3. `enrichSingleEvent` takes a fast path when `description_es` is present and `description_en` is not: it calls `translateText(es, 'es-to-en')` and skips the Jina fetch entirely (venue extraction is skipped too — venues are settled at import for these sources).

**Rationale:** The "Spanish description without English" state is shared across all native-description sources, so the fix belongs in the shared enrichment pipeline, not at the source level. Translating an existing description is cheaper, faster, and more reliable than re-scraping the page, and it produces the same end state (bilingual descriptions + regenerated embedding + presentation fields, `enrichment_status: 'completed'`).

**Verification:** Ran the enrichment over Venti events — 135/135 translated (0 failed), plus 3 in a smoke test; all 138 Venti events with `description_es` now have `description_en`. New events are handled by the daily `enrich-events` job.

**Related Decision:** "Venti as a Sixth Automated Scrape Source (Niche Bar/Club Events)" (2026-08-10).

**Verification:** Local run inserted 178 events (verified in DB). Deployed version `20260810.17` (10 tasks); a prod run triggered via the dashboard executed the full pipeline and updated 178/178 events (dedupe → update path) in the DB.

**Related Decision:** none.

---

### Single Retrieval Surface: Consolidate Chat Agent Tools from 15 to 8

**Date:** 2026-08-08

**Decision:** Collapsed all event discovery into `search_events` and deleted six tools:
1. **`get_tonights_events` / `get_happening_now`** — folded into `search_events` via `timeFilter: "tonight"` and a new `timeFilter: "now"` (the "now" path queries started-not-ended events and applies remaining filters in memory).
2. **`get_event_stats` / `list_neighborhoods_with_events` / `list_categories_with_events`** — deleted. Aggregate enumeration is analytics, not concierge recommendations; the stats tool was observed hijacking vague asks ("no sé qué hacer hoy") and returning zero events.
3. **`share_event`** — deleted. Every event card already renders a share button (`EventActions` + `getEventUrl`), and the tool hand-built broken URLs (`/events/` plural path that 404s, wrong default domain).
4. **`get_user_context`** — deleted as a tool. The chat route now injects auth state + saved-events count into the system prompt, saving one model step per conversation.

Also: the concierge prompt's decision rules now state the limit mechanism imperatively ("call search_events with limit 1 — or omit, default is 1"), and the dead Anthropic-era tool registry (`tools/index.ts`, `ToolName`, `*ToolUseBlock` types for removed tools) was removed.

**Alternatives Considered:**
- Keeping the convenience tools with sharper descriptions: Rejected — overlapping tools with fuzzy selection rules have no consistently right answer; evals showed DeepSeek Flash choosing differently run to run (tool-choice drift).
- Server-side limit caps per detected intent: Rejected — intent classification is the model's job; the eval suite is the enforcement mechanism.

**Rationale:** Concierge evals (added the same week) showed two recurring failure classes — decisive asks leaking lists via the tonight tool's default limit of 10, and neighborhood/vibe queries routed to convenience tools with narrower semantics. One retrieval tool with a default limit of 1 removes the wrong choice by construction. Verified post-change with `evals/concierge` runs.

**Verification:** `bun run eval:concierge` gates future prompt/model changes; golden search eval unaffected (retrieval path unchanged).

---

### Pre-Marketing Simplification: Remove Analytics Dashboard, Personalization, and "Planned"

**Date:** 2026-08-08

**Decision:** Removed three subsystems to shrink the codebase to the core loop (chat → recommendation → save):
1. **In-app admin analytics dashboard** — deleted the `/admin/analytics` route, chart components, PostHog query layer, and the `recharts` dependency. PostHog's own UI already answers every question this page did.
2. **Preferences/personalization subsystem** — deleted the profile preferences form, `user_preferences` API/hooks, the personalization prompt, and the chat agent's preference wiring (context tool, search defaults, prompt sections). Users can express preferences directly in chat.
3. **"Planned" layer on top of "Saved"** — removed `planned_at` handling, `confirmPlan`, `getSavedEventState`, `YourPlanCard`, and the "Make it happen" flow. There is now a single save concept; the hero recommendation card and event page use `SaveEventButton`.

**Alternatives Considered:**
- Keeping personalization behind a feature flag: Rejected — dead code paths still cost maintenance and the feature wasn't validated.
- Migrating the DB to drop `planned_at` / `user_preferences`: Rejected — destructive with no benefit pre-traction; the columns simply became unused.

**Rationale:** Pre-marketing stage; shrink the maintenance surface (screens, i18n strings, agent prompt complexity) so iteration stays cheap during the marketing push. Reinstate any piece only when usage data justifies it.

**Convention note:** Admin ops UI (scraping, blocklist, venue review) is **frozen** — operate via SQL/scripts. No new admin screens without explicit approval.

---

### Real-Time Nominatim Address Resolution for Venue Imports

**Date:** 2026-01-27

**Decision:** Detect address-like venue names during import and attempt to resolve them to business names via Nominatim API before creating venues.

**Problem:**
Event sources sometimes provide street addresses as venue names (e.g., "Thames 1234", "Av. Corrientes 5678") instead of actual business names. This created:
1. Duplicate venues (address-name alongside proper venue name)
2. Poor data quality (addresses aren't searchable as venues)
3. Manual cleanup burden via the Address Names admin tab

**Solution:**
Integrated address detection and resolution into the venue settlement pipeline:

1. **Detection** (`nominatim.ts`): 13 regex patterns identify Buenos Aires address formats:
   - Street prefixes: `Av.`, `Avenida`, `Calle`, `Pasaje`, `Cnel.`
   - Street + number: `Thames 1234`, `1234 Thames`
   - Intersections: `Corrientes y Callao`, `esq.`, `entre`
   - Building descriptors: `Piso`, `Local`, `Oficina`, `Depto`

2. **Resolution** (`nominatim.ts`): `lookupBusinessAtAddress()` queries Nominatim and extracts business name from `display_name` if different from just the street address.

3. **Integration** (`venue-settlement.ts`): Before matching/creating venues:
   - If address-like name detected → query Nominatim
   - If business found → use business name, store original address in `address` field
   - If no business → keep address as venue name, flag for admin review

4. **Status tracking**: Set `address_check_status` at creation:
   - Resolved address → business: `'not_flagged'`
   - Address-like but no business: `'flagged'` (shows in Address Names tab)
   - Not address-like: `'not_flagged'`

**Flow Diagram:**
```
Venue Name: "Thames 1234"
    │
    ▼
isAddressLikeVenueName() → true
    │
    ▼
lookupBusinessAtAddress("Thames 1234")
    │
    ├── Business found: "La Catedral Club"
    │   └── Create venue: name="La Catedral Club", address="Thames 1234", status='not_flagged'
    │
    └── No business found
        └── Create venue: name="Thames 1234", status='flagged' (admin review)
```

**Alternatives Considered:**
- **Batch AI detection only**: Reactive - bad venues already in DB before flagging
- **Google Maps API**: Paid, requires API key management, more complex
- **Scraper-level detection**: Scattered logic, hard to maintain consistency

**Rationale:**
1. **Prevention over cleanup**: Catch address-names at import time, not after
2. **Free API**: Nominatim is free with 1 req/sec rate limit (already rate-limited in settlement)
3. **Graceful fallback**: If Nominatim fails, venue still created with flag for manual review
4. **Reduced admin burden**: Address Names tab now only shows truly unresolvable cases

**Consequences:**
- Imports with many new venues may be slower (1 second per address-like venue for Nominatim)
- Venues not in OpenStreetMap won't be resolved (flagged for manual review)
- Legacy address-names remain in DB (one-time cleanup may still be needed)

**Files Modified:**
- `src/features/import/core/nominatim.ts` - Added `isAddressLikeVenueName()`, `lookupBusinessAtAddress()`
- `src/features/import/core/venue-settlement.ts` - Integrated address detection, added `address_check_status` to `createVenue()`

---

### Light Mode Color Scheme Redesign ("Buenos Aires Sunlight")

**Date:** 2026-01-26

**Decision:** Switch from dark mode "Noche Porteña" palette to a warm light mode "Buenos Aires Sunlight" palette.

**Problem:**
The app used a dark mode design (warm noir with amber gold accents), but industry research shows events apps almost universally use light mode because:
- Better readability for glanceable info (event names, times, venues)
- Events apps are often used outdoors where light mode maintains readability
- Event photos/imagery pop better on light backgrounds
- Light backgrounds convey openness, clarity, and approachability

**Research:**
Parallel research on 5 aspects:
1. Eventbrite's color scheme (orange CTAs, purple text, white backgrounds)
2. Meetup's color scheme (red brand, teal CTAs, white backgrounds)
3. Events app UI trends 2024-2025 (60-30-10 rule, warm colors for energy)
4. DICE/Resident Advisor schemes (nightlife exception: dark mode acceptable)
5. Light mode best practices (off-white backgrounds, WCAG contrast, shadows)

**Alternatives Considered:**
- **Option B: "Festival Vibrante"** - Electric purple + coral pink. Rejected: too bold, less universal appeal.
- **Option C: "Elegant Porteño"** - Keep amber gold in light mode. Rejected: coral is more energetic and event-appropriate.
- **Light + dark mode toggle** - Rejected: adds maintenance burden, most events apps are light-only.

**New Palette:**
| Token | Color | Hex Approximation |
|-------|-------|------------------|
| Background | Warm off-white | `#FAFAF8` |
| Foreground | Warm near-black | `#1F1B16` |
| Primary (CTAs) | Coral | `#E85A4F` |
| Accent | Teal | `#0D9488` |
| Muted | Light warm gray | `#F5F4F2` |
| Border | Subtle gray | `#E0DDD9` |

**Files Modified:**
- `src/styles.css` - Complete palette replacement, scrollbar, glows, prose styles
- `src/routes/__root.tsx` - Theme-color meta tag, removed dark class
- `src/routes/admin/analytics/*.tsx` - Chart colors updated for light mode

**Commit:** `f739839`

---

### Meetup Scraper Migration to Trigger.dev Playwright

**Date:** 2026-01-25

**Decision:** Migrate the Meetup scraper from Browserless.io to Trigger.dev's native Playwright extension.

**Problem:**
Browserless.io connections were failing from Trigger.dev infrastructure:
- Token was valid (verified)
- Scraper worked locally with the same token
- Trigger.dev logs showed connection failures to Browserless.io
- Issue was infrastructure/network between Trigger.dev and Browserless.io

**Solution:**
Replaced Browserless.io/Puppeteer with Trigger.dev's `@trigger.dev/build` Playwright extension:
- Removed ~180 lines of Browserless/Puppeteer connection code
- Uses native Playwright with Chromium installed in container
- Simpler code, fewer dependencies, no external service

**Files Modified:**
- `src/trigger/jobs/scrape-meetup.ts` - Replaced Browserless with Trigger.dev Playwright
- `trigger.config.ts` - Added playwright build extension

**Verification:**
Deployed v20260125.1 - test scrape completed successfully (7 events fetched, 2 inserted).

**Related Decision:** Trigger.dev Scraper Reliability Fixes (2026-01-15)

---

### Passline Trigger.dev Playwright Attempt (Failed)

**Date:** 2026-01-25

**Decision:** Keep Passline as local/client-side only. Trigger.dev Playwright does not bypass Cloudflare.

**Problem:**
After successfully migrating Meetup to Trigger.dev Playwright, attempted the same for Passline to enable automated scraping.

**Investigation:**
1. **Trigger.dev Playwright**: Cloudflare blocks headless browser requests from Trigger.dev infrastructure, same as Browserless.io
2. **Website scraping alternative**:
   - Individual event pages have JSON-LD data (descriptions work)
   - But filtered event listings (needed to discover events) trigger Cloudflare
   - Event pages lack region identifiers, so can't filter to CABA without the listings API

**Conclusion:**
Passline's Cloudflare protection blocks all server-side approaches, regardless of whether it's direct API, Browserless.io, or Trigger.dev Playwright. The blocking is IP/infrastructure-based, not just user-agent based.

**Solution:**
Continue using local Playwriter + client-side API approach:
- Import via admin UI (user's real browser bypasses Cloudflare)
- Enrichment via `/enrich-passline` skill (local Playwriter)

**Related Decision:** Disable Scheduled Passline Scraper (2026-01-11)

---

### React Query for Instant Admin Event List Updates

**Date:** 2026-01-15

**Decision:** Replace `router.invalidate()` with React Query's `setQueryData()` for instant UI updates after event mutations in the admin events page.

**Problem:**
After updating an event (e.g., adding a venue), it took ~10 seconds for the event to disappear from filtered views like "missing venue". This was because `router.invalidate()` triggered a full route refetch of all events from the database.

**Solution:**
Use React Query with `initialData` from the route loader, then update the cache directly on mutation success:

```typescript
// Route still loads data (no loading flash)
loader: async () => ({
  activeEvents: await listActiveEventsAdmin(),
  tabCounts: await getEventTabCountsAction({ data: {} }),
})

// Component wraps with useQuery for cache management
const { data: activeEvents } = useQuery({
  queryKey: queryKeys.events.adminList(),
  queryFn: listActiveEventsAdmin,
  initialData: loaderActiveEvents,
  staleTime: 30_000,
})

// Mutations update cache directly
onSuccess: (updatedEvent) => {
  queryClient.setQueryData<EventListItem[]>(
    queryKeys.events.adminList(),
    (old) => old?.map(e => e.id === updatedEvent.id ? { ...e, ...updatedEvent } : e)
  )
  queryClient.invalidateQueries({ queryKey: queryKeys.events.tabCounts({}) })
}
```

**Alternatives Considered:**
- **Keep router.invalidate()**: Rejected - 10 second delay is poor UX
- **Optimistic updates before server response**: Rejected - we have the real data from the server, no need to guess
- **useState initialized from loader + useEffect sync**: Rejected - TkDodo's blog warns this is an anti-pattern that causes sync bugs
- **Full migration away from route loader**: Rejected - loader provides instant initial render, React Query provides instant updates; best of both worlds

**Rationale:**
1. **Instant updates**: Events disappear from filtered views immediately after mutation
2. **No loading flash**: `initialData` from loader means data is available on first render
3. **Official pattern**: TanStack Query docs recommend `setQueryData` for updating cache with mutation responses
4. **Granular invalidation**: Tab counts refresh in background (~1-2s) while list updates instantly

**Files Modified:**
- `src/shared/lib/query.ts` - Added `adminList()` and `adminPastList()` query keys
- `src/routes/admin/events/index.tsx` - Wrapped loader data with `useQuery`
- `src/features/events/hooks/useEventMutations.ts` - Replaced `router.invalidate()` with `setQueryData()`

---

### Trigger.dev Scraper Reliability Fixes

**Date:** 2026-01-15

**Decision:** Implement three fixes to improve reliability of automated Trigger.dev scraper jobs: rate limiting with exponential backoff for AI categorization, client consistency for duplicate detection, and retry logic for browser frame detachment.

**Problems Observed:**
1. **Rate limit 429 errors** in `scrape-eventbrite` and `scrape-ba-tourism`: Anthropic API was being hit too fast during AI categorization
2. **Duplicate key constraint violations** in `scrape-eventbrite`: Events already existed in database but duplicate check returned false
3. **Frame detachment errors** in `scrape-meetup`: "Navigating frame was detached" failed for every day in a 30-day period

**Solutions:**

**1. AI Categorizer Rate Limiting (`src/features/import/scrapers/ai-categorizer.ts`):**
- Increased delay between requests from 100ms to 1500ms (Anthropic limit is 50 req/min)
- Added exponential backoff retry logic: 3 attempts with 2s, 4s, 8s delays
- Added `isRateLimitError()` helper to detect 429 responses

```typescript
for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  try {
    // ... API call
  } catch (err) {
    if (isRateLimitError(err) && attempt < MAX_RETRIES - 1) {
      const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt)
      await sleep(backoffMs)
      continue
    }
    throw err
  }
}
```

**2. Duplicate Detection Client Mismatch (`src/features/import/api/duplicate-detection.ts`):**
- Root cause: Duplicate check used anonymous Supabase client while inserts used service role client
- RLS policies may have hidden existing events from the anonymous client, causing "new event" false positives
- Fix: Added optional `client` parameter to `checkDuplicateEvents()` and `checkDuplicateEventsWithData()`
- Updated all 5 core import files to pass the service role client

**3. Meetup Frame Detachment (`src/features/import/scrapers/meetup/browser-scraper.ts`):**
- Root cause: Known Chromium bug (marked P2) that occurs with dynamic iframes and `puppeteer.connect()`
- Added `--disable-features=site-per-process` to browser launch args (documented workaround)
- Added retry logic: 3 attempts per date with page recreation on frame detachment
- Added `isFrameDetachmentError()` helper to detect various frame error messages
- Added failed days tracking for visibility in logs

```typescript
for (let retry = 0; retry < MAX_PAGE_RETRIES && !success; retry++) {
  try {
    await scrapePageForEvents(page, url, seenIds, collectedEvents)
    success = true
  } catch (error) {
    if (isFrameDetachmentError(error) && retry < MAX_PAGE_RETRIES - 1) {
      await page.close().catch(() => {})
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
      page = await browser.newPage() // Recreate page
    }
  }
}
```

**Files Modified:**
- `src/features/import/scrapers/ai-categorizer.ts` - Rate limiting + exponential backoff
- `src/features/import/api/duplicate-detection.ts` - Optional client parameter
- `src/features/import/core/eventbrite.ts` - Pass client to duplicate detection
- `src/features/import/core/meetup.ts` - Pass client to duplicate detection
- `src/features/import/core/ba-tourism.ts` - Pass client to duplicate detection
- `src/features/import/core/passline.ts` - Pass client to duplicate detection
- `src/features/import/core/luma.ts` - Pass client to duplicate detection
- `src/features/import/scrapers/meetup/browser-scraper.ts` - Frame detachment retry logic
- `src/shared/lib/browser/constants.ts` - Added `--disable-features=site-per-process` to shared args

**Alternatives Considered:**
- **For rate limiting**: Batch API calls - Anthropic doesn't support batching for messages API
- **For duplicate detection**: Use blind upsert - Rejected because we want to track inserted vs updated counts
- **For frame detachment**: Switch to Puppeteer - Same underlying Chromium issue; specialized services add cost

**Rationale:**
1. **Exponential backoff** is industry standard for handling rate limits gracefully
2. **Client consistency** ensures RLS doesn't cause false negatives in duplicate detection
3. **Page recreation** is the documented workaround for Chromium frame detachment bug

---

### Migrate to Vercel AI SDK

**Date:** 2026-01-13

**Decision:** Replace the custom Anthropic SDK streaming implementation with Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/react`) for simplified agent loops, built-in streaming, and better TypeScript integration.

**Related Decisions:**
- True Agent Loop with Event Accumulation (2026-01-13) - Previous custom implementation
- Agent-Native Architecture: Tier 1 User Action Tools (2026-01-13) - Tools migrated to AI SDK format

**Problem:**
The custom agent implementation in `agent.ts` (~571 lines) had:
1. Manual agent loop logic with iteration tracking
2. Custom SSE streaming with `sendEvent()` helper
3. Manual tool execution with type guards
4. Complex stream parsing on client with `processStream()`
5. Manual message history management

**Solution:**
Migrate to Vercel AI SDK which provides:

1. **Server-side (`/api/chat`):**
```typescript
import { streamText, createUIMessageStream } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'

return createUIMessageStream({
  execute: async (writer) => {
    const result = streamText({
      model: anthropic('claude-sonnet-4-5-20250929'),
      system: getSystemPrompt(locale),
      messages: convertToAIMessages(history),
      tools: createTools(userContext, locale),
      maxSteps: 5, // Replaces manual iteration loop
      onStepFinish: ({ toolCalls, toolResults }) => {
        // Accumulate events from tool results
      },
    })
    // Stream text and send custom data
    result.pipeTextStreamToResponse(writer)
    writer.write({ type: 'data-events', data: events })
  },
})
```

2. **Client-side (`ChatContainer`):**
```typescript
import { useChat } from '@ai-sdk/react'

const { messages, sendMessage, status } = useChat({
  api: '/api/chat',
  body: { locale: getLocale() },
  onData: (dataPart) => {
    if (dataPart.type === 'data-events') setEvents(dataPart.data)
  },
})
```

3. **Tool wrappers (`tools-ai-sdk.ts`):**
```typescript
import { tool } from 'ai'

export function createTools(userContext, locale) {
  return {
    search_events: tool({
      description: searchEventsTool.description,
      parameters: searchEventsInputSchema, // Reuse existing Zod schemas!
      execute: async (input) => searchEventsTool.execute(input, context),
    }),
    // ... 16 more tools
  }
}
```

**Key Architectural Changes:**

| Before (Custom) | After (AI SDK) |
|-----------------|----------------|
| Manual `while` loop with `MAX_ITERATIONS` | `maxSteps: 5` parameter |
| Custom `sendEvent()` for SSE | `createUIMessageStream` + `writer.write()` |
| Manual tool type guards | Built-in tool result typing |
| Custom `processStream()` parsing | `useChat` hook with `onData` |
| `anthropicSchema` for tool definitions | Direct Zod schema usage |

**Files Created:**
- `src/routes/api/chat.ts` - New API route using AI SDK
- `src/features/chat/api/tools-ai-sdk.ts` - Tool wrappers for AI SDK format
- `src/features/chat/api/suggestions.ts` - Extracted from agent.ts

**Files Modified:**
- `src/routes/-components/chat/ChatContainer.tsx` - Migrated to `useChat` hook
- `src/features/chat/index.ts` - Updated exports

**Files Deleted:**
- `src/features/chat/api/agent.ts` - Replaced by API route

**Alternatives Considered:**
- **Keep custom implementation**: Rejected - more code to maintain, no ecosystem benefits
- **LangChain**: Rejected - heavier abstraction, less control, not needed for single-model use
- **Migrate incrementally**: Considered but rejected - clean break simpler than maintaining two systems

**Rationale:**
1. **Simpler agent loop**: `maxSteps` replaces 50+ lines of iteration logic
2. **Built-in streaming**: No more manual SSE formatting or parsing
3. **Provider abstraction**: Easy to switch models (Anthropic → OpenAI) if needed
4. **Better TypeScript**: First-class Zod integration, typed tool results
5. **Ecosystem**: Well-maintained by Vercel, active community
6. **Reduced code**: ~571 lines in agent.ts → ~150 lines in API route

**Custom Data Streaming Pattern:**
For sending non-text data (events, suggestions, directions) alongside the streamed response:

```typescript
// Server: After streaming completes
writer.write({ type: 'data-events', data: events })
writer.write({ type: 'data-suggestions', data: suggestions })

// Client: In onData callback
onData: (dataPart) => {
  if (dataPart.type === 'data-events') setEvents(dataPart.data)
}
```

---

### True Agent Loop with Event Accumulation

**Date:** 2026-01-13

**Decision:** Replace the fixed 2-call maximum model with a true agent loop that continues until Claude naturally stops using tools (`stop_reason === 'end_turn'`) or hits a configurable maximum iteration limit (default: 5).

**Related Decisions:**
- Single-Search with Relevance Filtering for Chat Agent (2025-12-30) - This decision supersedes that approach
- Remove RELEVANT Event Filtering from Chat Agent (2025-12-31)

**Problem:**
The previous 2-call maximum architecture (search → forced response) limited the agent's ability to handle complex multi-step queries like:
- "Help me plan my weekend" (requires: list saved events + search new events + compare)
- "Find techno tonight, but show me what I've already saved first" (requires: list saved → search → compare)
- "What's happening now? Actually, save that one" (requires: get_happening_now → get_event_details → save_event)

**Historical Context:**
The 2-call limit was introduced in the "Single-Search with Relevance Filtering" decision (2025-12-30) due to "Text/events mismatch" - events were streamed immediately per iteration, so Claude's final text might describe different events than displayed.

**Why It's Now Safe to Revisit:**
1. The concierge approach (2025-01-13) defaults to `limit=1` single recommendations
2. Most queries still complete in 1-2 iterations naturally
3. The synchronization fix (events sent only at end) solves the root cause

**Solution:**

```typescript
// Configuration
const MAX_ITERATIONS = 5

// True agent loop
while (!done && iteration < MAX_ITERATIONS) {
  const response = await anthropic.messages.create({ ... })

  if (result.stopReason === 'end_turn') {
    done = true  // Natural completion
  } else if (result.stopReason === 'tool_use') {
    // Execute tools, accumulate events, continue loop
  }
}

// Safety valve
if (!done) {
  // Force final response with tool_choice: { type: 'none' }
}
```

**Key Architectural Changes:**

1. **Event Accumulation**: Events are collected across ALL iterations using a Map (keyed by ID for deduplication). Events are only sent to the client after the loop completes.

2. **Natural Termination**: Agent stops when Claude returns `stop_reason === 'end_turn'`, not after a fixed number of calls.

3. **Safety Limits**: `MAX_ITERATIONS = 5` prevents runaway loops. If hit, forces a text response.

4. **Analytics**: Each tool call includes `iteration` count for monitoring loop behavior.

**Why This Solves the Historical Issues:**

| Historical Issue | Solution |
|------------------|----------|
| Events sent immediately | Events accumulated, sent only at end |
| Text/events mismatch | Final text generated after all tools complete |
| Runaway iterations | MAX_ITERATIONS safety limit |
| Cost concerns | Concierge defaults to limit=1, most queries complete in 1-2 iterations |

**Alternatives Considered:**
- **Keep 2-call maximum**: Rejected - limits emergent capability for complex queries
- **Explicit `complete` tool**: Rejected - research showed implicit termination (`end_turn`) is best practice
- **Higher iteration limit (10+)**: Rejected - 5 is sufficient for foreseeable use cases, can increase later

**Rationale:**
1. **Emergent capability**: Agent can now handle queries we didn't explicitly design for
2. **User agency**: "Save that, then find me something else" just works
3. **Maintains safety**: Event accumulation + max iterations prevent historical issues
4. **Monitoring**: Iteration tracking reveals actual usage patterns

**Files Modified:**
- `src/features/chat/api/agent.ts` - Replaced 2-call model with true loop

---

### Agent-Native Architecture: Tier 1 User Action Tools

**Date:** 2026-01-13

**Decision:** Implement user action tools for the AI agent following the "Agent-native Architecture" principles from the article by Dan Shipper and Claude. Added tools for save_event, unsave_event, list_saved_events, get_event_details, and check_event_saved.

**Inspiration:**
The "Agent-native Architectures" article outlines 5 key principles:
1. **Parity** - Whatever the user can do through the UI, the agent should be able to achieve through tools
2. **Granularity** - Tools should be atomic primitives
3. **Composability** - With atomic tools and parity, you can create new features just by writing prompts
4. **Emergent Capability** - The agent can accomplish things you didn't explicitly design for
5. **Improvement Over Time** - Agent-native apps get better through accumulated context

**Problem:**
Our AI concierge had only 2 tools (search_events, get_venue_details), creating a significant parity gap:
- Users could save events via UI but agent could not
- Agent had no knowledge of user's saved events
- Agent couldn't help users manage their event list
- Agent had no user context (was effectively anonymous)

**Solution:**

Implemented Tier 1 tools with secure session-based authentication:

| Tool | Purpose | Auth Required |
|------|---------|---------------|
| save_event | Save event to user's list | Yes |
| unsave_event | Remove event from list | Yes |
| list_saved_events | Get user's saved events | Yes |
| get_event_details | Get full event info | No |
| check_event_saved | Check if event is saved | Yes |

**Security Model:**
- User identity derived from server-side session cookies via `getSessionUser()`
- LLM never sees user IDs or tokens (brokered credentials pattern)
- Supabase Row-Level Security (RLS) provides secondary protection
- Graceful degradation for anonymous users (helpful error messages)

**Analytics:**
Added server-side PostHog tracking for all tool usage to understand:
- Which tools users actually use
- Success/failure rates
- Auth patterns (how often tools fail due to not being logged in)

**Alternatives Considered:**
- **OAuth On-Behalf-Of**: Enterprise pattern, too complex for this use case
- **Passing user tokens to LLM**: Security risk, LLM could leak tokens
- **MCP Authorization**: Anthropic's emerging pattern, not yet production-ready
- **Client-side only tools**: Would lose the ability to act on user's behalf

**Rationale:**
1. **Parity principle**: Users can now say "save that" instead of clicking buttons
2. **Security**: Session-based delegation is simple and well-understood
3. **Extensibility**: Pattern easily extends to future tools (Tier 2, Tier 3)
4. **Analytics**: Tool usage data will inform which features to build next

**Files Created:**
- `src/features/chat/api/user-tools.ts` - Server functions for user actions
- `docs/agent-native-architecture.md` - Analysis and recommendations document

**Files Modified:**
- `src/features/chat/api/agent.ts` - Added tools, type guards, executors, system prompt
- `src/shared/lib/types.ts` - Added tool input types and tool use block types
- `src/lib/analytics.ts` - Added server-side tracking with posthog-node

**Next Steps (Tier 2 Tools):**
- `get_user_context` - User preferences, saved count, recent searches
- `get_happening_now` - Events currently in progress
- `get_tonights_events` - Quick access to tonight's events

**References:**
- "Agent-native Architectures" by Dan Shipper and Claude (Every)
- See `docs/agent-native-architecture.md` for full analysis

---

### Mark Events as Cancelled When Enrichment Encounters 404

**Date:** 2026-01-12

**Decision:** When event enrichment encounters a 404 or 410 HTTP error (event page no longer exists), mark the event as `status: 'cancelled'` for audit purposes instead of just marking enrichment as failed.

**Problem:**
During enrichment, some event pages return 404 errors because:
- The event was cancelled by the organizer
- The event listing expired
- The event page was removed
- The URL structure changed

Previously, these events were marked with `enrichment_status: 'failed'` but kept `status: 'scheduled'`, meaning they would still appear in chat recommendations and the admin would keep retrying enrichment.

**Solution:**
Created `HttpError` class pattern to distinguish HTTP errors from other failures:

```typescript
// src/shared/lib/errors.ts
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly url: string
  ) { ... }

  get isNotFound(): boolean {
    return this.status === 404 || this.status === 410
  }
}
```

Fetch functions (`fetchHtml`, `fetchWithJina`, Eventbrite fetchers) now throw `HttpError` on non-OK responses. The enrichment catch block detects this and marks events as cancelled:

```typescript
catch (error) {
  if (error instanceof HttpError && error.isNotFound) {
    await updateEventEnrichment(client, id, {
      status: 'cancelled',
      enrichment_status: 'failed',
      enrichment_error: `HTTP ${error.status} - Event page not found`,
    })
    return { eventId: id, success: false, enriched: false, cancelled: true }
  }
  // ... existing error handling
}
```

**Why `cancelled` status:**
- The `cancelled` status already existed in the database enum - no migration needed
- Chat agent filters to `status = 'scheduled'` only - cancelled events automatically hidden from users
- Admin UI already has red badge styling for cancelled events
- Preserves audit trail (vs. deleting events entirely)

**Alternatives Considered:**
- **Delete events**: Loses audit trail, makes debugging harder
- **Mark as `past`**: Incorrect semantically - the event didn't happen, it was removed
- **Change return types**: Would require updating many callers; throwing errors is cleaner
- **Retry later**: Events removed from source don't come back; retrying wastes resources

**Rationale:**
1. **Data integrity**: Events aren't lost, just marked as unavailable
2. **User experience**: Cancelled events don't pollute recommendations
3. **Audit trail**: Admin can see which events were cancelled and why
4. **Error class pattern**: Centralizes HTTP error handling, makes 404 detection explicit
5. **Existing infrastructure**: Leverages existing `cancelled` status and UI styling

**Files Created:**
- `src/shared/lib/errors.ts` - HttpError class

**Files Modified:**
- `src/shared/lib/html-parsing.ts` - fetchHtml throws HttpError
- `src/shared/lib/ai/enrichment.ts` - fetchWithJina throws HttpError
- `src/features/import/core/event-enrichment.ts` - Catches HttpError, marks cancelled, tracks stats
- `src/features/import/scrapers/eventbrite/enrichment.ts` - Eventbrite fetchers throw HttpError
- `src/trigger/jobs/enrich-events.ts` - Tracks cancelled count in metadata/logs
- `src/trigger/jobs/enrichment-catchup.ts` - Tracks cancelled count in metadata/logs

---

### Unified Description Enrichment Button

**Date:** 2026-01-11

**Decision:** Consolidate three separate description enrichment buttons (Generic, Passline, Luma) into a single "Add Descriptions" button that automatically routes events to the correct enrichment strategy based on their source.

**Problem:**
The admin events page had three separate enrichment buttons with overlapping but exclusive functionality:
- "Add Descriptions" - For generic sources using Jina Reader + Claude AI
- "Passline Descriptions" - For Passline events using client-side JSON-LD extraction
- "Luma Descriptions" - For Luma events using Playwright scraping

This created UX confusion:
1. Users had to understand which button to use for which events
2. Mixed selections (e.g., 10 Passline + 5 Luma + 5 Meetup) required clicking multiple buttons
3. Three separate buttons cluttered the bulk action bar

**Solution:**
Created `useUnifiedDescriptionEnrichment` hook that:
1. Partitions selected events by source
2. Looks up enrichment strategy using source-to-strategy mapping
3. Executes enrichments sequentially by source (Passline → Luma → Generic)
4. Tracks combined progress across all sources
5. Provides unified stop functionality

**Source-to-Strategy Mapping:**

| Source | Strategy | Hook Used | Stoppable |
|--------|----------|-----------|-----------|
| passline | Client-side JSON-LD | usePasslineDescriptionEnrichment | Yes |
| luma | Playwright scraping | useLumaDescriptionEnrichment | Yes |
| meetup | Jina + Claude | useBackgroundEnrichment | Yes |
| eventbrite | Jina + Claude | useBackgroundEnrichment | Yes |
| ba-tourism | Jina + Claude | useBackgroundEnrichment | Yes |
| csv | None | N/A | N/A |

**Alternatives Considered:**
- **Replace hooks entirely**: Rejected - existing hooks are well-tested and may be needed for source-specific operations
- **Parallel execution**: Rejected - harder to track progress, race conditions in cache invalidation
- **Client-only orchestration**: Rejected - would lose server-side streaming progress

**Rationale:**
1. **Single entry point**: One button handles all description enrichment
2. **Preserves existing logic**: Orchestrates hooks rather than replacing them
3. **Extensible**: New sources just add an entry to the strategy map
4. **Progressive feedback**: Combined progress + source-aware toast messages
5. **Stop all**: Unified stop halts current source and prevents subsequent execution

**Files Created:**
- `src/features/events/hooks/useUnifiedDescriptionEnrichment.ts`
- `src/features/events/hooks/description-enrichment-strategies.ts`

**Files Modified:**
- `src/routes/admin/events/-components/enrichments-config.ts` - Simplified to single description config
- `src/routes/admin/events/index.tsx` - Use unified hook
- `src/features/events/index.ts` - Export new hook

---

### Lazy Initialization for Server-Only SDKs

**Date:** 2026-01-11

**Decision:** Always use lazy initialization (getter function pattern) for server-only SDKs like Anthropic, OpenAI, etc. Never instantiate these at module scope.

**Problem:**
The language dropdown (and all other interactive elements) stopped working because React hydration was failing silently. Investigation revealed:

1. `eventbrite/enrichment.ts` had `const anthropic = new Anthropic()` at module scope
2. When any page imported from `@/features/import`, the barrel file triggered this import
3. The Anthropic SDK detected the browser environment and threw an error
4. This error occurred during JavaScript bundle evaluation, **before React could hydrate**
5. Result: No React event handlers attached, all interactive elements non-functional

**Console error observed:**
```
AnthropicError: It looks like you're running in a browser-like environment
```

**Solution:**
Use lazy initialization pattern - SDK is only instantiated when actually called on the server:

```typescript
// ❌ BAD: Executes immediately when module loads (crashes in browser)
const anthropic = new Anthropic()

// ✅ GOOD: Only instantiates when function is called (on server)
let anthropicClient: Anthropic | null = null

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic()
  }
  return anthropicClient
}

// Usage in server functions
const message = await getAnthropicClient().messages.create({ ... })
```

**Pattern already used correctly in:**
- `src/shared/lib/ai/enrichment.ts` (lines 16-23)

**Pattern was incorrect in:**
- `src/features/import/scrapers/eventbrite/enrichment.ts` (fixed)

**Why this happens:**
1. JavaScript bundlers evaluate all imported modules to build the dependency tree
2. Barrel files (`index.ts` with `export * from './module'`) cause transitive imports
3. Even if a module is only used on the server, if it's in the import chain, it gets evaluated
4. Server-only SDKs often detect browser environment and throw errors
5. These errors during bundle evaluation prevent React from completing hydration

**When to apply this pattern:**
- **Always** for: Anthropic SDK, OpenAI SDK, database clients, any SDK that throws in browser
- **Not needed for**: Pure utility functions, types, constants

**Alternatives Considered:**
- `server-only` package: Prevents import entirely, too restrictive if you need the module in shared code
- Dynamic imports: More complex, harder to type correctly
- Separate server-only entry points: Requires restructuring exports

**Rationale:**
1. **Zero runtime cost**: Lazy init adds negligible overhead
2. **No build config changes**: Works with any bundler
3. **Self-contained**: Fix is in the module itself, no external coordination needed
4. **Matches existing pattern**: Already used in `shared/lib/ai/enrichment.ts`

**Detection tips:**
- If React hydration fails silently (no `__reactFiber` on DOM elements), check console for SDK errors
- Search for `new Anthropic()`, `new OpenAI()`, etc. at module scope
- Trace import chains from routes through barrel files

**Files Modified:**
- `src/features/import/scrapers/eventbrite/enrichment.ts` - Changed to lazy initialization

---

### SSR Auth State via Route Context

**Date:** 2026-01-11

**Decision:** Fetch authentication state in the root route's `beforeLoad` hook and pass it to `AuthProvider` via route context, instead of relying solely on client-side `useQuery`.

**Problem:**
The sidebar was showing "Iniciar sesión" (Sign In) even when the user was logged in because:
1. `useQuery` in `AuthProvider` does NOT execute during SSR
2. Server-rendered HTML had `user = null` → sidebar showed login button
3. While `beforeLoad` in protected routes correctly detected auth (redirecting `/login` → `/admin`), this data wasn't shared with React components
4. Client-side query should refetch after hydration, but there was no network request being made

**Investigation:**
- Used Chrome browser automation to verify server-rendered HTML showed login button
- Network inspection confirmed no `getSessionUser` server function call was being made
- Server-side `beforeLoad` correctly detected session (login page redirected to `/admin`)
- The disconnect was between server-side route guards and client-side React state

**Solution:**
Following the [TanStack Start Authentication pattern](https://tanstack.com/start/latest/docs/framework/react/guide/authentication):

1. **Root route fetches session in `beforeLoad`:**
```typescript
// src/routes/__root.tsx
export const Route = createRootRoute({
  beforeLoad: async (): Promise<RootRouteContext> => {
    const session = await getSessionUser()
    return { session }
  },
  // ...
})
```

2. **AuthProvider accepts `initialSession` prop:**
```typescript
// src/shared/providers/AuthProvider.tsx
export function AuthProvider({ children, initialSession }: AuthProviderProps) {
  const { data: sessionUser } = useQuery({
    queryKey: ['session'],
    queryFn: () => getSessionUser(),
    initialData: initialSession ?? undefined, // SSR data prevents flash
    staleTime: 1000 * 60 * 5,
  })
  // ...
}
```

3. **Route context passes session to provider:**
```typescript
function RootDocument() {
  const { session } = Route.useRouteContext()
  return (
    // ...
    <AuthProvider initialSession={session}>
      {children}
    </AuthProvider>
  )
}
```

**Alternatives Considered:**
- **React Query SSR with HydrationBoundary**: More complex setup with `dehydrate`/`hydrate`, overkill for single query
- **Client-only with loading skeleton**: Would still show flash of logged-out state
- **Supabase client-side auth only**: Loses SSR benefits, exposes auth state mismatch

**Rationale:**
1. **TanStack Start native pattern**: Uses route context as recommended by docs
2. **Single fetch**: `beforeLoad` runs once on server, data is reused via `initialData`
3. **No hydration mismatch**: Server and client render same auth state
4. **Graceful degradation**: `useQuery` still refetches if needed (window focus, stale data)

**Files Modified:**
- `src/routes/__root.tsx` - Added `beforeLoad`, route context type, pass `initialSession`
- `src/shared/providers/AuthProvider.tsx` - Added `initialSession` prop with `initialData`

**References:**
- [TanStack Start Authentication Guide](https://tanstack.com/start/latest/docs/framework/react/guide/authentication)
- [TanStack Start Basic Auth Example](https://tanstack.com/start/latest/docs/framework/react/examples/start-basic-auth)
- [React Query SSR Guide](https://tanstack.com/query/v5/docs/framework/react/guides/advanced-ssr)

---

### Unified Enrichment Adapter Pattern

**Date:** 2026-01-11

**Decision:** Create a unified `EnrichmentAdapter` interface separate from the existing `SourceAdapter` to encapsulate source-specific enrichment strategies (client-side vs server-side, extraction methods, language handling).

**Related Decision:** Client-Side Description Extraction for Passline Events (2026-01-11)

**Problem:**
Enrichment logic was scattered across multiple files with source-specific conditionals:
- `useImportWizard.ts` had separate fetch functions per source (e.g., `fetchLumaEventsNeedingEnrichment`, `fetchPasslineEventsNeedingEnrichment`)
- `event-enrichment.ts` had `if (source === 'meetup')` branches
- No central documentation of which sources need client vs server enrichment

**Alternatives Considered:**
- **Extend SourceAdapter**: Rejected - enrichment and import are separate concerns with different lifecycles
- **Configuration object only**: Rejected - source-specific logic still needed encapsulation
- **No adapter, just documentation**: Rejected - code still needs routing logic

**Solution:**
Created `EnrichmentAdapter` interface with:
1. **capabilities**: What the source can enrich (descriptions, venues)
2. **config**: Execution strategy (client/server, language, concurrency)
3. **extractDescriptions/extractVenues**: Client-side extraction (for Cloudflare-blocked sources)
4. **serverEnrich**: Server-side extraction (for Jina-compatible sources)
5. **getEnrichmentUrl**: URL extraction from preview events

**Files Created:**
```
src/features/import/adapters/
├── enrichment-types.ts         # EnrichmentAdapter interface
└── enrichment/
    ├── index.ts                # Registry + helper functions
    ├── passline-enrichment.ts  # Client-side (Cloudflare blocks)
    ├── meetup-enrichment.ts    # Server direct fetch (Jina 451)
    ├── luma-enrichment.ts      # Server-side Jina
    ├── ba-tourism-enrichment.ts # Server-side Jina + AI
    └── eventbrite-enrichment.ts # Server-side Jina + AI
```

**Enrichment Strategy Matrix:**

| Source | Strategy | Reason | Language |
|--------|----------|--------|----------|
| Passline | Client-side | Cloudflare blocks server | Spanish |
| Meetup | Server direct fetch | Jina returns 451 | Detect |
| Luma | Server Jina | Works normally | Detect |
| BA Tourism | Server Jina + AI | Works normally | Spanish |
| Eventbrite | Server Jina + AI | Works normally | Detect |

**Usage:**
```typescript
import { getEnrichmentAdapter, requiresClientSideEnrichment } from '@/features/import/adapters'

const adapter = getEnrichmentAdapter('passline')
if (adapter?.config.requiresClientSide) {
  // Route to client-side extraction
  const results = await adapter.extractDescriptions?.(events, onProgress)
} else {
  // Route to server-side enrichment
  const result = await adapter?.serverEnrich?.(link, { extractVenue: true })
}
```

**Rationale:**
1. **Self-documenting**: Each adapter declares its strategy and reason
2. **Centralized routing**: `getEnrichmentAdapter()` provides single entry point
3. **Type-safe**: TypeScript enforces correct adapter implementation
4. **Extensible**: New sources just add an adapter file
5. **Testable**: Adapters are pure functions with no global state

**Consequences:**
- Existing enrichment code (`useImportWizard.ts`, `event-enrichment.ts`) can gradually migrate to use adapters
- New sources must implement an enrichment adapter
- Decision matrix is documented in both code and `docs/event-import-enrichment.md`

---

### Client-Side Description Extraction for Passline Events

**Date:** 2026-01-11

**Decision:** Implement client-side description extraction for Passline events using JSON-LD, bypassing the server-side Jina Reader flow that fails due to Cloudflare blocking.

**Problem:**
Passline events were imported without descriptions because:
1. The standard enrichment flow uses Jina Reader (`r.jina.ai/{url}`) to fetch page content
2. Jina Reader returns HTTP 200 but gets the wrong content (country selector page instead of event page)
3. Server-side requests to Passline are blocked by Cloudflare
4. Without descriptions, events cannot generate proper embeddings for recommendations

**Investigation:**
- Used Chrome browser automation to check Passline event pages
- Found that **JSON-LD structured data contains full event descriptions**
- Example: Event "TAN BIONICA en Santa Fe" has 1,041-character description in JSON-LD
- JSON-LD is already being extracted client-side for venue information

**Solution:**
1. **Extended `client-enrichment.ts`** to also extract `description` from JSON-LD (alongside venue info)
2. **Created `enrichPasslineDescriptionsAction`** server action that:
   - Takes Spanish descriptions already extracted client-side
   - Translates them to English using Claude
   - Generates embeddings
   - Saves both descriptions to the database
3. **Created `usePasslineDescriptionEnrichment` hook** that:
   - Extracts descriptions client-side via `extractPasslineEventsBatchClient`
   - Sends to server for translation and saving
4. **Updated `enrichSingleEvent`** to skip Passline events (they require client-side extraction)

**Files Created/Modified:**
- `src/features/import/scrapers/passline/client-enrichment.ts` - Added description extraction
- `src/features/events/api/enrichment.ts` - Added `enrichPasslineDescriptionsAction`, skip Passline in `enrichSingleEvent`
- `src/features/events/hooks/usePasslineDescriptionEnrichment.ts` - New hook for client-side flow
- `src/features/events/index.ts` - Exported new functions
- `src/features/import/index.ts` - Exported new types

**Usage:**
To enrich Passline events with descriptions:
1. Go to Admin > Events
2. Select Passline events with enrichment_status = 'pending'
3. Click "Fetch Passline Descriptions" (once UI button is added)

**Consequences:**
- Passline description enrichment requires user action (client-side extraction)
- The "Add Descriptions" button will skip Passline events (shows message to use Passline-specific button)
- Descriptions are in Spanish, translated to English via Claude API

**Related Decision:** Disable Scheduled Passline Scraper (2026-01-11)

---

### Disable Scheduled Passline Scraper (Cloudflare Blocking)

**Date:** 2026-01-11

**Decision:** Remove Passline from the daily automated scrape job. Passline imports must now be done manually via the admin UI.

**Problem:**
Passline implemented aggressive Cloudflare bot protection that blocks all server-side requests:
- Direct API calls return **HTTP 403 Forbidden**
- Browserless.io with stealth mode: blocked
- Browserless.io with residential proxy: blocked
- Network interception approach: blocked
- All configurations show "Un momento..." / "Just a moment..." Cloudflare challenge page

The scheduled Trigger.dev job (`scrape-passline`) has failed for multiple consecutive days.

**Testing Performed:**
Created test scripts to evaluate multiple bypass approaches:
1. `test-passline-browserless-api.ts` - Execute fetch inside Browserless browser context → CORS error
2. `test-passline-browserless-scrape.ts` - Scrape website directly → Cloudflare blocked
3. `test-passline-network-intercept.ts` - Intercept API calls during page load → Cloudflare blocked
4. `test-passline-browserless-proxy.ts` - Try stealth, proxy, default configs → All blocked

**Alternatives Considered:**
- **Specialized Cloudflare bypass services** (ScrapingBee, ZenRows, Bright Data): Would add cost and may still fail as Cloudflare updates
- **Keep retrying with Browserless**: Wastes resources, consistently fails
- **Contact Passline for API access**: Uncertain timeline, may not be granted

**Solution:**
1. Removed `scrape-passline` from `daily-scrape.ts` orchestrator
2. Passline import wizard in admin UI still works (runs in real browser context)
3. Added comments in code explaining why Passline is excluded

**Files Modified:**
- `src/trigger/jobs/daily-scrape.ts` - Removed Passline from SOURCE_JOBS and trigger calls

**Consequences:**
- Passline events must be imported manually by an admin
- Manual imports work because they run in the user's actual browser
- If Passline relaxes their Cloudflare rules in the future, the job can be re-enabled

**Related Decision:** Client-Side Fetch for Passline Scraper (2025-12-29)

---

### Handle Hidden Event Addresses (Luma Placeholder Detection)

**Date:** 2026-01-11

**Decision:** Detect placeholder venue text like "Register to See Address" during import, prevent fake venue creation, and display a user-friendly message indicating registration is required to see the address.

**Problem:**
Luma events can have hidden addresses that show "Register to See Address" instead of actual location. Previously:
- This placeholder text was treated as a real venue name
- A fake venue record got created in the database
- Events got linked to this fake venue, polluting venue data

**Solution:**
1. Add `location_hidden` boolean column to events table (default `false`)
2. Add `isPlaceholderVenue()` function to detect patterns like "Register to See Address", "TBA", "TBD", etc.
3. Update venue settlement to return `action: 'placeholder'` when detected
4. Update Luma imports (both manual wizard and Trigger.dev job) to set `location_hidden: true`
5. Update EventCard UI to show "Address after registration" with a registration link
6. Hide the map button in EventActions when `location_hidden` is true

**Alternatives Considered:**
- Store the placeholder text as venue name: Pollutes venue data with fake entries
- Skip importing these events entirely: Loses valuable events just because address is hidden
- Show generic "No address" message: Less helpful than explaining registration is required

**Rationale:**
1. **Data integrity**: Prevents fake venues from being created
2. **User clarity**: Users understand they need to register to see the address
3. **Actionable**: Registration link provides a clear path forward
4. **Industry standard**: Matches how Luma, Partiful, and other platforms handle this pattern

**Placeholder Patterns Detected:**
```typescript
const PLACEHOLDER_PATTERNS = [
  /register\s*(to\s*)?see\s*address/i,
  /address\s*(to\s*be\s*)?(confirmed|tba|tbd)/i,
  /location\s*(to\s*be\s*)?(confirmed|tba|tbd|announced)/i,
  /^tba$/i,
  /^tbd$/i,
  /^to\s*be\s*(announced|confirmed|determined)$/i,
]
```

**Files Modified:**
- `supabase/migrations/20260111123144_add_location_hidden.sql` - Database column
- `src/features/import/core/venue-settlement.ts` - Placeholder detection
- `src/features/import/core/luma.ts` - Trigger.dev job
- `src/features/import/api/luma.ts` - Manual import
- `src/routes/-components/events/EventCard.tsx` - UI display
- `src/routes/-components/events/EventActions.tsx` - Hide map button
- `src/shared/lib/types.ts` - TypeScript types

---

### Client-Side Pagination for Admin Events Table

**Date:** 2026-01-10

**Decision:** Load all events in the route loader and perform filtering, sorting, and pagination client-side instead of using server-side pagination.

**Previous Approach:**
- Server-side pagination via `useEventsPaginated` hook with React Query
- Route loader only fetched venues; events fetched client-side via `useQuery`
- Caused loading flash: empty state → filters → data (3 render phases)

**New Approach:**
```typescript
// Route loader fetches ALL data upfront
loader: async () => {
  const [venues, allEvents] = await Promise.all([
    listVenues(),
    listAllEventsAdmin(), // Fetches up to 5000 events
  ])
  return { venues, allEvents }
}

// Component filters/paginates client-side with useMemo
const filteredEvents = useMemo(() => filterEvents(allEvents, searchParams), [allEvents, searchParams])
const sortedEvents = useMemo(() => sortEvents(filteredEvents, sortBy, sortDir), [filteredEvents, sortBy, sortDir])
const events = sortedEvents.slice((page - 1) * pageSize, page * pageSize)
```

**Alternatives Considered:**
- Server-side pagination with `initialData`: Still caused multiple render phases due to separate tab counts query
- SSR hydration with React Query: Complex setup with dehydration/hydration, overkill for admin page
- Loading skeleton: Would hide the flash but data still loads in phases

**Rationale:**
1. **Instant rendering**: All data available on first render, no loading flash
2. **Instant interactions**: Tab switching, filtering, pagination are immediate (no network)
3. **Simplicity**: Removed complex `useEventsPaginated` hook with server-side queries
4. **Appropriate for dataset size**: ~500-2000 events is well within client-side handling capacity
5. **URL state preserved**: Filters/pagination still use URL search params for shareability

**Trade-offs:**
- ✅ No loading flash or intermediate states
- ✅ Instant filtering, sorting, pagination
- ✅ Simpler code (no React Query for events)
- ✅ Reduced server requests
- ❌ Initial page load fetches more data (~100KB for 1000 events)
- ❌ Memory usage higher on client (all events in memory)
- ❌ Not suitable if dataset grows to 10,000+ events

**When to use this pattern:**
- Dataset under ~5000 records
- Frequent filtering/pagination expected
- Loading flash is unacceptable UX
- Admin/internal tools where initial load time is acceptable

**When NOT to use:**
- Large datasets (10,000+ records)
- Public-facing pages where initial payload size matters
- Data changes frequently and needs real-time server state

---

### React State for Edit Modals (Performance Fix)

**Date:** 2025-01-10

**Related Decision:** Instant Edit Modal Pattern for Admin (2025-01-10)

**Decision:** Switch edit modal state from URL search params (`?editId=<id>`) to local React state (`useState`) for instant open/close performance.

**Problem:**
Even with `loaderDeps: () => ({})`, TanStack Router still treats search param changes as full navigations that go through the routing lifecycle. This caused a noticeable ~1 second delay when opening/closing edit modals due to:
1. Router navigation processing
2. Route component re-renders triggered by search param changes
3. React Query dependency recalculations (even when query keys don't change, new object references are created)

**Solution:**
```typescript
// Before: URL-based (slow)
const editingEvent = useMemo(
  () => searchParams.editId ? events.find(e => e.id === searchParams.editId) : null,
  [events, searchParams.editId]
)
const handleEdit = (event) => navigate({ search: prev => ({ ...prev, editId: event.id }) })

// After: React state (instant)
const [editingEvent, setEditingEvent] = useState<EventWithVenue | null>(null)
const handleEdit = (event) => setEditingEvent(event)
```

**Additional optimization:** Only mount the modal component when needed:
```typescript
// Before: Always mounted, controlled by prop
<EditEventSheet event={editingEvent} onClose={handleCloseEdit} />

// After: Conditionally mounted
{editingEvent && <EditEventSheet event={editingEvent} onClose={handleCloseEdit} />}
```

**Trade-offs:**
- ❌ No shareable link to specific event edit (`/admin/events?editId=xyz`)
- ❌ No browser back button to close modal
- ✅ Instant open/close (pure React state update, no router involvement)
- ✅ Simpler code (no URL schema, no navigation calls)
- ✅ Reduced re-renders (state change is local, not global route change)

**Rationale:** For admin edit modals, instant UX is more important than URL sharing. Users rarely share links to "edit this specific event" - they share the admin page itself. The performance improvement is immediately noticeable.

**Applied to:**
- Events: `EditEventSheet` - uses `useState<EventWithVenue | null>`
- Venues: `EditVenueDialog` - uses `useState<Venue | null>`

---

### Instant Edit Modal Pattern for Admin

**Date:** 2025-01-10

**Decision:** Use modal-based editing with URL search param sync (`?editId=<id>`) instead of page navigation for admin entity editing. Applied to both events (Sheet) and venues (Dialog).

**Pattern:**
```typescript
// 1. Add editId to URL search schema
const eventSearchSchema = z.object({
  // ... other params
  editId: z.string().optional(),
})

// 2. Derive editing state from cached data (instant!)
const editingEvent = useMemo(
  () => searchParams.editId ? events.find(e => e.id === searchParams.editId) ?? null : null,
  [events, searchParams.editId]
)

// 3. Open/close via URL navigation
const handleEdit = (event) => navigate({ search: prev => ({ ...prev, editId: event.id }) })
const handleCloseEdit = () => navigate({ search: prev => ({ ...prev, editId: undefined }) })

// 4. Sheet/Dialog controlled by null check
<EditEventSheet event={editingEvent} onClose={handleCloseEdit} />
```

**Alternatives Considered:**
- Keep page navigation (`/admin/events/$id`): Slow, server-side loading breaks flow
- Route masking (TanStack Router feature): More complex, overkill for this use case
- Client-side state only (`useState`): Loses URL sharing and browser back button

**Rationale:**
1. **Instant UX**: Modal opens immediately using cached data from table (no server round-trip)
2. **URL sync**: Shareable links (`/admin/events?editId=abc`), browser back button closes modal
3. **Consistent pattern**: Matches existing `EditVenueDialog` approach in venues admin
4. **Simple implementation**: Search params recommended by TanStack Router maintainer

**Applied to:**
- Events: `EditEventSheet` (`src/routes/admin/events/-components/EditEventSheet.tsx`)
- Venues: `EditVenueDialog` (`src/routes/admin/venues/-components/EditVenueDialog.tsx`)

**Performance Optimization - loaderDeps:**

By default, TanStack Router's stale-while-revalidate behavior causes route loaders to re-run in the background when search params change. This caused a ~2 second delay when opening/closing edit modals because the loader would refetch all venues from Supabase.

**Fix:** Use `loaderDeps: () => ({})` to tell the router the loader doesn't depend on any search params:

```typescript
export const Route = createFileRoute('/admin/venues/')({
  validateSearch: venueSearchSchema,
  // Loader doesn't depend on any search params - prevents reload on editId change
  loaderDeps: () => ({}),
  loader: async () => listVenues(),
  component: VenueListPage,
})
```

**How it works:**
- `loaderDeps` specifies which search params should trigger loader re-runs
- Returning `{}` means "no dependencies" - loader only runs on initial page load
- Changing `editId` (or any search param) won't trigger a reload
- If your loader DOES depend on search params (e.g., pagination), include them: `loaderDeps: ({ search }) => ({ page: search.page })`

**References:**
- TanStack Router recommendation: https://github.com/TanStack/router/discussions/1966
- TanStack Router Data Loading: https://tanstack.com/router/v1/docs/framework/react/guide/data-loading

---

### URL-Based State Management for Admin Filters

**Date:** 2025-01-09

**Decision:** Use URL search params as the single source of truth for all filter, pagination, and tab state in the admin events table. Implemented using TanStack Router's type-safe search params with Zod validation.

**Pattern:**
```typescript
// 1. Define Zod schema with defaults
const eventSearchSchema = z.object({
  tab: z.enum(['all', 'needs_attention', 'pending_review', 'past']).optional().catch('all'),
  page: z.number().optional().catch(1),
  search: z.string().optional(),
  showPast: z.boolean().optional().catch(false),
  // ... other filters
})

// 2. Route validates search params
export const Route = createFileRoute('/admin/events/')({
  validateSearch: eventSearchSchema,
})

// 3. Hook provides typed setters that update URL
const { filters, setShowPast, setSearch } = useEventsPaginated({
  searchParams: Route.useSearch(),
  navigate: Route.useNavigate(),
})

// 4. Setters update URL, which triggers re-render with new params
const setShowPast = (value: boolean) => {
  navigate({
    search: (prev) => ({ ...prev, showPast: value || undefined, page: 1 }),
  })
}
```

**Alternatives Considered:**
- React state (`useState`/`useReducer`): Loses state on refresh, can't share URLs
- Global state (Zustand/Redux): Adds complexity, still loses state on refresh
- localStorage persistence: Complex sync logic, can't share URLs with others

**Rationale:**
1. **Shareable URLs**: Users can bookmark or share exact filter combinations (e.g., `/admin/events?tab=needs_attention&missingDescription=true`)
2. **Browser history works**: Back/forward buttons navigate through filter states
3. **Refresh preserves state**: No lost work when refreshing the page
4. **Type safety**: Zod schema validates params, `.catch()` provides defaults for invalid values
5. **Single source of truth**: No sync bugs between URL and component state
6. **Deferred defaults**: Using `.catch()` instead of `.default()` means invalid params get defaults without URL changes

**Consequences:**
- New filters must be added to both Zod schema and `useEventsPaginated` hook
- Filter setters should reset `page: 1` when changing filters (avoids empty page edge cases)
- Boolean filters use `value || undefined` pattern to keep URLs clean (false = omitted from URL)
- The hook converts URL param names to API param names (e.g., `venue` → `venueId`)

---

### Serverless-Compatible Scraping Strategy

**Date:** 2025-01-09

**Related Decision:** Playwright for Browser-Based Scrapers (2025-12-29)

**Decision:** When scraping web content, choose the approach based on execution context:

| Context | Approach | Why |
|---------|----------|-----|
| **Netlify Server Functions** (`src/features/*/api/`) | Fetch + HTML parsing, OR Browserless.io | Netlify has no Playwright binaries |
| **Trigger.dev Jobs** (`src/trigger/jobs/`) | Playwright (local) | Jobs run in containers with full browser support |
| **Client-side** | Fetch (if CORS allows) | Browser handles requests directly |

**Key Rule:** Never use `chromium.launch()` in server functions under `src/features/*/api/`. These run on Netlify serverless which lacks Playwright browser binaries.

**Alternatives Considered:**
- Bundle Playwright browsers: Rejected - 100MB+ bundle size, exceeds Netlify limits
- Always use Browserless.io: Acceptable fallback but adds cost and latency
- Move all scraping to Trigger.dev: Best for long-running operations

**Rationale:**
1. Netlify serverless has 10-26 second timeout AND no Playwright binaries
2. JSON-LD and `__NEXT_DATA__` are in initial HTML, making Playwright unnecessary for many extractions
3. Trigger.dev jobs have 30+ minute timeouts and full container environments

**Consequences:**
- Before adding Playwright to any `api/` file, consider if fetch + parsing suffices
- For JS-rendered content in server functions, use Browserless.io as fallback
- Document any new Playwright usage in server functions as tech debt

---

### Vertical Slice Architecture Restructuring

**Date:** 2025-12-31

**Decision:** Restructure the codebase from technical-type organization to a Vertical Slice architecture with:
1. `features/` directory for business logic modules (events, venues, import, chat, auth)
2. `shared/` directory for truly shared code (UI components, database, utilities)
3. Route colocation using TanStack Router's `-components/` pattern for route-specific UI

**Alternatives Considered:**
- Feature-Sliced Design (FSD): 7-layer architecture with strict dependency rules - too rigid for this project size, adds complexity with layers like "entities" and "widgets" that would be overkill
- Features in routes: Embedding all feature code directly in route folders - rejected because business logic (hooks, API functions) is often shared across multiple routes
- Continue with current structure: Technical-type organization (`components/`, `hooks/`, `lib/`) was becoming hard to navigate as the codebase grew

**Rationale:**
1. **Maintainability focus**: Everything for a feature is in one place - no more hunting across `components/`, `hooks/`, `lib/` for related code
2. **Clear public APIs**: Each feature has an `index.ts` that exports only what's needed, reducing coupling
3. **Route colocation**: Using `-components/` folders keeps route-specific UI close to routes while keeping routes thin
4. **Shared code discipline**: Only code used by 3+ features goes in `shared/`, preventing premature abstraction
5. **TanStack Router native**: Uses the `-prefix` convention for files/folders the router should ignore

**Structure:**
```
src/
├── features/           # Feature modules with business logic
│   ├── events/         # Event management
│   │   ├── api/        # Server functions
│   │   └── hooks/      # React hooks
│   ├── venues/         # Venue management
│   ├── import/         # Import wizard
│   ├── chat/           # Chat/AI feature
│   └── auth/           # Authentication
├── shared/             # Truly shared code
│   ├── ui/             # shadcn + custom UI
│   ├── lib/            # Utils, DB, types
│   └── providers/      # Context providers
└── routes/             # Thin route files
    └── admin/events/
        ├── index.tsx   # Route (composition only)
        └── -components/ # Route-specific UI
```

**References:**
- [TanStack Router File-Based Routing](https://tanstack.com/router/v1/docs/framework/react/routing/file-based-routing)
- [Tips from 8 months of TanStack/Router in production](https://swizec.com/blog/tips-from-8-months-of-tan-stack-router-in-production/)
- [Vertical Slice Architecture](https://www.jimmybogard.com/vertical-slice-architecture/)

---

### Node.js Module Polyfills for Vite Client Build

**Date:** 2025-12-31

**Decision:** Use Vite resolve aliases to polyfill/stub Node.js modules (`node:stream`, `node:stream/web`, `node:async_hooks`) that leak into the client bundle from TanStack packages.

**Alternatives Considered:**
- Specific import paths (e.g., `@tanstack/start-client-core/createServerFn`): Package doesn't export individual modules; barrel exports pull in SSR code regardless
- Using `serverOnly()` directive and dedicated server-only files: Investigated but the import chain is in TanStack packages themselves, not our code
- Waiting for upstream fix: GitHub issues #4022 and #6185 addressed different aspects; the barrel export issue persists in v1.144+
- Netlify plugin configuration: Plugin is a thin wrapper with no special handling for Node.js module externalization

**Rationale:**
1. **Root cause**: TanStack Start's barrel exports (`export * from "@tanstack/start-client-core"`) defeat tree-shaking. Even though packages have separate `./ssr/server` and `./ssr/client` exports, the main exports pull in modules that import `node:stream`.
2. **Import chain traced**:
   - `@tanstack/react-start` → `@tanstack/start-client-core`
   - `@tanstack/start-client-core/index.js` → imports from `@tanstack/router-core/ssr/client`
   - `createServerFn.js` → imports `mergeHeaders` from `@tanstack/router-core/ssr/client`
   - Chain eventually reaches `transformStreamWithRouter.js` which imports `{ Readable } from "node:stream"`
3. **Polyfill solution**: `stream-browserify` and `web-streams-polyfill` provide browser-compatible implementations. Custom stub for `async_hooks` provides no-op implementations.
4. **Pragmatic choice**: Polyfills add ~15KB gzipped but work reliably. The alternative is waiting for TanStack to restructure their exports, which may not happen.

---

### Client-Side Chunked Batching for Meetup Scraper

**Date:** 2025-12-31

**Decision:** Chunk Meetup date ranges into 7-day batches on the client side to avoid HTTP request timeouts when scraping large date ranges.

**Alternatives Considered:**
- Background jobs: Would require additional infrastructure (job queue, worker processes), harder to show real-time progress
- Streaming responses: Complex to implement, TanStack server functions don't support streaming well
- Increasing server timeout: Doesn't address root cause, just delays the problem

**Rationale:**
1. **Root cause**: HTTP request timeouts (~60-120s) kill long-running requests before Meetup scraping completes. A 31-day range takes ~4 minutes.
2. **7-day chunks**: Each batch completes in ~30-40 seconds, well under timeout limits
3. **Progress UI**: Users see "Batch 2/5 (35 events)" - better UX than a spinner for 4 minutes
4. **Error resilience**: If one batch fails, we show partial results + continue with other batches
5. **Deduplication**: Events appearing in multiple batches are deduped by `meetup.id`
6. **No infrastructure changes**: Works with existing serverless architecture

---

### Remove RELEVANT Event Filtering from Chat Agent

**Date:** 2025-12-31

**Decision:** Remove the `RELEVANT:["id1","id2"]` marker system that filtered which events to display. Now all search results are shown directly without Claude-based filtering.

**Related Decision:** Single-Search with Relevance Filtering for Chat Agent (2025-12-30)

**Alternatives Considered:**
- Keep RELEVANT filtering with stricter prompting: Still prone to text/card mismatches
- Filter BEFORE response (two-step): Adds latency and complexity for marginal benefit

**Rationale:**
1. **Text/card mismatch**: Claude would describe N events in text but mark fewer as "relevant", causing UI to show fewer cards than described
2. **Complexity**: The filtering added parsing logic, regex matching, and failure modes
3. **Search quality is sufficient**: Semantic search with filters returns relevant results; second-layer AI filtering added complexity without proportionate benefit

---

### Single-Search with Relevance Filtering for Chat Agent

**Date:** 2025-12-30

**Decision:** Replace the agentic loop (up to 5 iterations) with a single-search model where Claude makes ONE tool call per message, filters results for relevance, and refinement suggestions help users iterate.

**Alternatives Considered:**
- Keep agentic loop with better sync: Complex to fix text/events mismatch when Claude retries
- Show all semantic search results: Overwhelms users with loosely related events
- Stricter similarity threshold in database: Less flexible, Claude can't apply contextual filtering

**Rationale:**
1. **Text/events mismatch**: The agentic loop caused Claude's text to describe different events than what was displayed (events sent immediately on tool execution, but Claude might retry and describe different results)
2. **Relevance filtering**: Semantic search returns loosely related results. Having Claude explicitly specify which events are relevant (via `RELEVANT:["id1","id2"]` marker) ensures only contextually appropriate events are shown
3. **User-driven refinement**: Instead of AI guessing how to refine searches, suggestion chips let users drive iteration (augment mode for results found, replace mode for zero results)
4. **UX research**: Industry best practice is "fewer, more relevant results" over showing everything

---

### 4-Hour Default Duration for Events Without End Times

**Date:** 2025-12-30

**Decision:** Mark events as "past" 4 hours after their start time if they have no end time specified.

**Alternatives Considered:**
- Wait until next calendar day: Too conservative - a 9pm event would still show until midnight
- Hide immediately when start time passes: Too aggressive - users might still want to discover ongoing events
- 2-hour default: Too short for concerts and club nights typical in Buenos Aires

**Rationale:** Research into event platforms (Eventbrite, Meetup, The Events Calendar) showed varying approaches. For Buenos Aires nightlife/events, 4 hours balances discoverability with relevance: concerts (2-4 hrs), club nights (4-6+ hrs), cultural events (1-3 hrs). A concert at 9pm hides by 1am; a club night at 11pm hides by 3am.

---

### Unified Collapsible Sidebar Navigation

**Date:** 2025-12-29

**Decision:** Replace header bar with a collapsible sidebar for both admin and main navigation.

**Rationale:** Sidebar provides more room for navigation items, collapses for more content space, and unifies the admin/user experience. Mobile uses hamburger menu on left side. Other AI apps follow this pattern.

---

### Playwright for Browser-Based Scrapers

**Date:** 2025-12-29

**Decision:** Use Playwright for scrapers that need JavaScript rendering (BA Tourism, Meetup venue enrichment).

**Alternatives Considered:**
- Puppeteer: Similar capabilities but Playwright has better API and cross-browser support
- Simple HTTP scraping: Doesn't work for JS-rendered content

**Rationale:** BA Tourism and Meetup pages require JavaScript execution. Playwright provides reliable browser automation with good TypeScript support and headless mode.

---

### Native HTML Table for DataTable

**Date:** 2025-12-29

**Decision:** Refactor DataTable to use native HTML table with sticky header instead of TanStack Virtual.

**Alternatives Considered:**
- TanStack Virtual: Good for huge lists but added complexity for header/body scroll sync
- CSS Grid layout: Harder to maintain table semantics

**Rationale:** Native HTML tables handle scroll sync naturally. Sticky header with `position: sticky` is simpler and works well. Virtualization still used for the table body rows.

---

### Two-Phase Import Pattern

**Date:** 2025-12-29

**Decision:** Implement a two-phase import: fast initial import, then on-demand enrichment.

**Alternatives Considered:**
- Full enrichment during import: Too slow, blocks user
- Background job queue: Added complexity, harder to debug

**Rationale:** Users want to see events quickly. Enrichment (descriptions, prices, categories) can happen later without blocking the import flow. Non-blocking background enrichment with progress toasts provides good UX.

---

### Bilingual Event Descriptions (Spanish/English)

**Date:** 2025-12-29

**Decision:** Store both Spanish and English descriptions for events (`description_es`, `description_en`).

**Alternatives Considered:**
- Single description field with on-demand translation: Slower, repeated API costs
- English-only: Loses authenticity, harder for Spanish speakers

**Rationale:** Spanish descriptions are authentic and better for embeddings (cross-lingual model handles queries in either language). English translations help English-speaking users understand event details.

---

### React Query + React Hook Form Infrastructure

**Date:** 2025-12-29

**Decision:** Add React Query for data fetching and React Hook Form with Zod for form handling.

**Alternatives Considered:**
- TanStack Router loaders only: Less control over cache invalidation and mutations
- Custom form state: More boilerplate, no validation integration

**Rationale:** React Query provides cache invalidation, optimistic updates, and mutation hooks. React Hook Form with Zod gives type-safe validation and reduces form boilerplate. Both integrate well with TanStack ecosystem.

---

### SECURITY DEFINER is_admin() Function

**Date:** 2025-12-29

**Decision:** Use a `SECURITY DEFINER` function for admin role checking to avoid RLS infinite recursion.

**Alternatives Considered:**
- Direct RLS policy on profiles table: Caused infinite recursion when checking admin status
- Separate admin table: Added complexity and sync issues

**Rationale:** RLS policies that reference the same table they protect can cause infinite loops. A `SECURITY DEFINER` function runs with elevated privileges, bypassing the recursion issue.

---

### Client-Side Fetch for Passline Scraper

**Date:** 2025-12-29

**Decision:** Move Passline API fetching to client-side instead of server-side.

**Alternatives Considered:**
- Server-side fetch with browser headers: Still blocked by Cloudflare
- Proxy server: Added infrastructure complexity and cost

**Rationale:** Cloudflare was blocking server-side requests even with browser headers. Client-side fetch from user's browser bypasses these blocks since it's a real browser request.

---

### Rate Limiting with Upstash Redis

**Date:** 2025-12-28

**Decision:** Use Upstash Redis for API rate limiting.

**Alternatives Considered:**
- In-memory rate limiting: Doesn't work across serverless instances
- Supabase-based: Added latency, not purpose-built for rate limiting

**Rationale:** Upstash provides serverless Redis with a generous free tier. Works across serverless function instances and has a simple rate limiting SDK.

---

### "Noche Porteña" Design Aesthetic

**Date:** 2025-12-28

**Decision:** Use a warm noir aesthetic inspired by Buenos Aires nightlife for the UI.

**Alternatives Considered:**
- Standard shadcn dark theme: Generic, not memorable
- Bright/colorful theme: Doesn't match the nightlife/events vibe

**Rationale:** The warm amber accents on dark backgrounds evoke Buenos Aires tango halls and nightlife. Creates a distinctive brand identity that matches the product's purpose.

---

### Semantic Search with pgvector (Lower Threshold)

**Date:** 2025-12-28

**Decision:** Use pgvector for semantic search with a lower similarity threshold (~0.3) for short queries.

**Alternatives Considered:**
- Higher threshold (0.7+): Too restrictive, missed relevant results
- Separate short/long query handling: Added complexity

**Rationale:** Short queries like "romantic evening" naturally have lower similarity scores against full event descriptions. The cross-lingual embedding model handles Spanish content well with English queries.

---

### TanStack Start over Next.js

**Date:** 2025-12-28

**Decision:** Use TanStack Start as the framework instead of Next.js.

**Alternatives Considered:**
- Next.js: More mature ecosystem, but heavier, React Server Components complexity, Vercel-centric deployment

**Rationale:** TanStack Start provides a lighter, more flexible foundation with native integration with TanStack Router and Query. Better suited for a single-page app experience with server functions.

---


---

### Switch to DeepSeek V4 Flash for text generation

**Date:** 2026-08-08

**Decision:** Replace Claude Haiku 4.5 with DeepSeek V4 Flash (`deepseek-v4-flash`) for all text-generation
work (chat agent, categorization, enrichment, titles, venue review), using the **Vercel AI SDK**
everywhere. Text runs on `@ai-sdk/deepseek` (DeepSeek's OpenAI-compatible endpoint,
`https://api.deepseek.com`); embeddings run on `@ai-sdk/openai` (`text-embedding-3-small`).

**Alternatives Considered:**
- Keep the Anthropic SDK + `@ai-sdk/anthropic` and point `baseURL` at DeepSeek's Anthropic-compatible
  endpoint (`https://api.deepseek.com/anthropic`): smallest diff, but DeepSeek ignores the
  `anthropic-beta` structured-outputs header (prompts must request JSON manually and parsing must be
  hand-rolled), and the AI SDK cannot cleanly toggle DeepSeek's thinking mode on the chat path.
- DeepSeek's OpenAI-format endpoint with the raw `openai` SDK: requires converting every Anthropic-shaped
  call site and hand-rolling structured-output parsing; chat still needs the AI SDK.
- Keep Claude: ~10x more expensive per token.

**Rationale:** The Vercel AI SDK consolidates all text generation into one abstraction
(`generateText`/`generateObject`/`streamText`), replaces the lost Anthropic structured outputs with
schema-validated `generateObject` (auto-repair on invalid output), and lets `providerOptions` cleanly
disable DeepSeek's default thinking mode (`thinking: { type: 'disabled' }`) everywhere, including chat.
It removes three dependencies (`@anthropic-ai/sdk`, `@ai-sdk/anthropic`, `openai`) in favor of two
(`@ai-sdk/deepseek`, `@ai-sdk/openai`), both pinned to the spec-v3 major that matches `ai@6`. The API
key resolves `AI_API_KEY` > `DEEPSEEK_API_KEY` > `ANTHROPIC_API_KEY`. Embeddings stay on OpenAI —
DeepSeek has no embeddings API.

**Related Decision:** DeepSeek's announced API price increase (2026-08-06) is expected to narrow but
not eliminate the cost advantage; founder guidance puts the increase in the 2x-10x range.

Related Decision: none (this supersedes the implicit "Claude for AI" choice from the original stack).

---

## Eventbrite Import: Detail-Page Enrichment + min_age Restored

**Date:** 2026-08-11

**Decision:** The Eventbrite importer now fetches each event's detail page and extracts
real start/end times, price, and minimum age before upserting. `min_age` is re-added to
the `events` table (it was dropped in 20260112145500 on 2026-01-12 as "unused").

**Context:** The Eventbrite listing JSON-LD is date-only (YYYY-MM-DD). The previous
transformer (`dateToIsoDatetime`) therefore stored every event as midnight-to-midnight
with `is_free=true`, `price=null` — a systemic data-quality bug affecting ~1,500 rows
(repaired in the data via re-fetching source pages). The detail page is the only place
times, price (AggregateOffer `lowPrice`), and age (`Highlights_ageRestriction`) exist.

**Alternatives Considered:**
- Single listing fetch with richer per-event JSON: the listing embeds no times/price/age — rejected (verified).
- Detail-page fetch in a separate post-import enrichment phase: adds a second write pass; inline override before upsert is cleaner — chosen.
- Text-regex age extraction (`mayores de X años`): false-positives from Eventbrite's embedded i18n dictionary and SVG path data — rejected; only the `Highlights_ageRestriction` span is used.

**Rationale:** One detail fetch per event (batched, concurrent, retried) yields correct
time/price/min_age at import time. Re-adding `min_age` restores the age field the app
types (`EventFilters.minAge`) already reference. Note: the migration must be applied to
the live DB (`bunx supabase db push` or SQL editor) — `min_age` does not exist yet.

## Remove Browserless.io/Puppeteer dead code + fix AI categorizer parse failures

**Date:** 2026-08-12

**Decision:** Remove all Browserless.io and Puppeteer code paths, and fix the AI
categorizer's JSON-parse fallbacks.

**Browserless/Puppeteer removal:** The `BROWSERLESS_TOKEN` env var was disabled in
`.env` (renamed `DISABLED_BROWSERLESS_TOKEN`) and every scraper had migrated to
either Browserbase cloud browsers (Passline, Meetup) or local Playwright (BA
Tourism, Passline enrichment). The remaining Browserless branches were unreachable,
and the shared factory (`createBrowserConnection`, `PageWrapper`,
`waitForCloudflareResolution`) had zero callers. Deleted
`src/shared/lib/browser/connection.ts` + `types.ts`, stripped the
`scrapeWithBrowserless`/`fetchWithBrowserless` branches from the passline and
ba-tourism scrapers, removed `puppeteer-core` from dependencies, and removed the
dead env var.

**Categorizer fix:** The `generateObject` call used a Zod schema requiring
`{"category": "..."}`, but the prompt told the model to "respond with ONLY the
category name". DeepSeek's OpenAI-compatible endpoint runs JSON-schema in
compatibility mode (no grammar-constrained decoding), so ~1/3 of responses were a
bare word that failed `safeParseJSON` → `NoObjectGeneratedError` → fallback to
`social`. Fixed the prompt in all three copies (ai-categorizer.ts,
eventbrite/enrichment.ts, recategorize-events.ts) to request a `{"category": ...}`
JSON object, and added `NoObjectGeneratedError` to the retryable-error set.

**Rationale:** Remove dead code that no longer executes (it hid the fact that BA
Tourism actually runs fine on local Playwright in prod). The categorizer prompt fix
removed a real ~33% fallback rate observed in production runs (21/64 events on
2026-08-11), verified live: 6/6 events categorized with zero fallbacks after the fix.

**Related:** env var `TRIGGER_API_KEY` was renamed to `TRIGGER_SECRET_KEY` (the name
the SDK actually reads), and `TRIGGER_SECRET_KEY_PROD` added for production run
visibility/triggering (dev key `tr_dev_` is scoped to the personal dev environment
and cannot see or trigger prod runs).

---

## Do not cache locale-sensitive SSR documents in the service worker

**Date:** 2026-08-13

**Decision:** Keep static assets and Google Fonts cached, but do not runtime-cache
server-rendered navigation documents in Workbox.

**Alternatives Considered:**
- Keep the existing `NetworkFirst` page cache: it can reuse Spanish HTML for an
  English client, causing React hydration to fail before the network refresh wins.
- Create separate page-cache keys for every locale: this duplicates Paraglide's
  cookie and preferred-language resolution inside the service worker and can still
  drift from the server.

**Rationale:** The server is the source of truth for locale negotiation. Navigation
documents are small and online event discovery already requires a live connection,
so correct SSR and hydration are more valuable than stale offline page shells.

---

## Re-embed scripts write via the service-role client (anon has no UPDATE on events)

**Date:** 2026-08-14

**Decision:** `scripts/reembed-stale.ts` writes `embedding`, `search_document`, and
`embedding_version` through `getSupabaseServiceRoleClient()` instead of the anon
`getSupabase()` client. Reads still use anon.

**Alternatives Considered:**
- Keep anon for writes: PostgREST returned `success: true` with `error: null` yet
  the row never changed (`updated_at` stayed frozen), so a full backfill would
  silently re-process the same stale rows forever with no error to catch.

**Rationale:** The anon role has no RLS `UPDATE` policy on `events`, so anon updates
are silently dropped. Embedded vectors/text written with the anon key never
persist. Service role bypasses RLS and is the only reliable writer for
maintenance scripts that mutate row state.

**Related:** `match_events_with_venues_filtered` / `lexical_match_events_with_venues`
and the PostgREST filter/count paths. See the "Avoid = hard exclude" note in
`docs/constrained-semantic-retrieval-plan.md` for the corrected facet predicate.

- - -

## Avoid-genre excludes must not drop events with missing facets

**Date:** 2026-08-14

**Decision:** The search avoid predicate excludes an event only if its
`facets.genres` actually overlaps the avoided list.
- SQL RPCs use `NOT (coalesce(facets->'genres','[]') ?| filter_avoid_genres)`.
- PostgREST filter-only / count paths apply avoid **in memory**
  (`applyAvoidGenres`) because no PostgREST JSONB filter expresses the overlap with
  the correct missing-key semantics.

**Alternatives Considered:**
- `NOT (facets->'genres' ?| arr)`: `facets->'genres'` is NULL for `facets = {}`
  (the pre-enrichment default), `NULL ?| arr` is NULL, `NOT NULL` is NULL, and a
  NULL WHERE clause drops the row — so every event without a `genres` key would be
  excluded even when it carries no avoided genre.
- PostgREST `.not('facets->genres','ov',arr)`: errors at runtime with
  `operator does not exist: jsonb && unknown`.
- PostgREST `cs` (contains) on `facets->genres`: also NULL-drops missing genres
  and only matches "contains the full set", not "shares any element".

**Rationale:** Avoid is a hard exclude but only meaningful against genres an event
actually has. Coalescing missing genres to `[]` keeps events without facets
eligible, which matches the import reality where most events are pre-enrichment
(`facets = {}`).

- - -

## Hosted Voyage rerank replaces facet-overlap rerank

**Date:** 2026-08-15

**Decision:** Stage-2 rerank of `search_events` candidates now calls the hosted
Voyage rerank API (`rerank-2.5-lite` by default, `VOYAGE_RERANK_MODEL` to
override) over compact per-event documents (name, summary, venue, neighborhood,
categories, facet labels, start, cost). Final order is weighted rank fusion
`2/(60+rerankerRank) + 1/(60+baseRank)` against retrieval order. The facet/chill
rerankers leave the production path (kept in `quality-diversity.ts` for the
offline eval's comparison variant). Failure, timeout (1.2s), or a missing
`VOYAGE_API_KEY` falls back to retrieval order — never facet order, never an
error. Retrieval rank is derived from the fused array order; `rrf.ts` and
`client.server.ts` are unchanged because the fusion is rank-based and reranker
scores are not calibrated across queries anyway.

Related Decision: "Generic prefer-facet rerank and default 3-item discovery
limit" (2026-08-15) — its stage-2 rerank is superseded by this one. The 3-item
discovery default stands.

**Alternatives Considered:**
- Self-hosted cross-encoder (bge/jina MiniLM on a persistent service): rejected
  — no model hosting on Netlify functions; another service to run.
- Listwise LLM rerank (one generateObject over ~30 cards): rejected — extra
  seconds of latency and cost on the chat path, positional bias, coarse grades
  leave most ordering to tie-breaks anyway.
- Keeping facet overlap as a post-rerank boost: rejected — double-counts a
  signal already present in the query text and the tags, and biases toward
  better-enriched events.

**Rationale:** Facet-overlap sorting ranks the extractor, not the event: a
weakly-matching tagged event could jump a strongly-matching untagged one, and
the RRF score was discarded entirely. A hosted cross-encoder reads name +
summary + tags, so uneven facet coverage stops mattering, while rank fusion
keeps retrieval evidence in the final order. The offline relevance eval
(`--rerank`) compares baseline vs facet vs voyage vs voyage+fused on the frozen
corpus before this ships to production behavior.

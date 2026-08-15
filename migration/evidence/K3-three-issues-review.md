# K3 review — three production issues

Independent review of the SvelteKit tree at `/Users/hanifcarroll/projects/ba-events`. No code changed, no git, no servers started. All paths below are relative to the repo root.

---

## 1. Chill recommendations

### Real code path

`concierge` prompt → `search_events` tool → hybrid retrieval → top-N slice:

1. `src/features/chat/api/prompts/concierge.ts` (Tools section, ~line 60) instructs the model to leave vibe text in `query`: *"Leave only descriptive/vibe text in query"*. So "chill" goes in as `query: "chill ..."`.
2. `src/features/chat/api/tools/search-events.ts` → `execute` → `canonicalizeSearchIntent(input, ...)` (`src/features/chat/api/tools/search-intent.ts`). That module's header explicitly says it *"never scores 'romantic'/'chill'"* — "chill" survives verbatim as `intent.semanticQuery`. There is no vibe mapping anywhere in canonicalization.
3. `search-events.ts` semantic branch calls `hybridEventSearch(query, filters, CANDIDATE_LIMIT)` (`src/shared/lib/db/client.server.ts:453`), which runs:
   - `semanticEventSearch` → RPC `match_events_with_venues_filtered` with **`match_threshold: 0.2`** hard-coded (`client.server.ts:398-414`; SQL in `supabase/migrations/20260101000000_add_hybrid_event_search.sql:77`: `1 - (e.embedding <=> query_embedding) > match_threshold`).
   - `lexicalEventSearch` → RPC `lexical_match_events_with_venues` over `search_document`.
   - Results fused by `rrfFuse` (`src/shared/lib/search/rrf.ts`).
4. Back in `search-events.ts`, the fused candidates are `slice(0, displayLimit)` (with only `applyDiversity` for lists > 1). There is **no quality or vibe rerank** — `quality-diversity.ts` never touches `facets`/`vibes`/`energy` (grep: zero hits).

### Root cause

Two compounding causes, exactly as reported:

**(a) Weak semantic matches.** The only signal for "chill" is cosine similarity against `embedding`, gated by a 0.2 threshold. 0.2 is barely a filter for 1536-dim text embeddings — unrelated short texts routinely score above it — so the threshold admits almost the whole upcoming-events set and ranking is pure vector order over whatever document each event has. The retrieval layer has **no facet-aware vibe filter**: the only facet-based predicate in either RPC is `filter_avoid_genres` (`supabase/migrations/20260814220748_add_avoid_genres_to_search_and_view_facets.sql:154,279` — `NOT (e.facets->'genres' ?| filter_avoid_genres)`). There is no `filter_vibes` / `filter_energy` parameter, and `prefer.vibes` is only concatenated into the embedding text (`search-intent.ts` `joinPreferIntoQuery`, ~line 525). Note also that `VIBE_VALUES` in `src/shared/lib/search-facets.ts:37-45` doesn't even contain "chill" — the closest canonical key is `relaxed` (plus `energy: 'low'`) — and nothing maps the user's word "chill" onto it.

**(b) Missing vibe data.** `facets` (vibes/energy) are populated only by `extractEventFacets` during enrichment (`src/features/import/core/event-enrichment.ts` step 5, ~line 310). Two gaps make them absent from retrieval even when present:

- **Unenriched events have empty facets and name-only documents.** Passline events are imported with `description_es: null` (`src/features/import/scrapers/passline/transformer.ts:49`) and `enrichment_status: 'pending'`; their import-time embedding/search document is built from name + categories + venue only (`src/features/import/core/passline.ts:209` `embedEventWithDocument({...})`). These rows are the enrichment backlog of issue 3 — many are party events, and their sparse documents are exactly what produces noisy "chill" matches.
- **The facets-only backfill path deliberately never re-embeds.** `enrichSingleEvent` (`event-enrichment.ts`, ~lines 170-190): *"Phase 5 forbids re-embed … update ONLY `facets`"*. So even after vibes are backfilled onto a previously-enriched row, neither `embedding` nor `search_document` contains the vibe phrases — the vector search can't match them semantically and the lexical FTS (over `search_document`, `supabase/migrations/20260812200000_add_lexical_search_and_search_document.sql`) can't match them textually. And since these rows already carry `embedding_version = CURRENT_EMBEDDING_VERSION` (2), `scripts/reembed-stale.ts` (which targets `embedding_version < CURRENT`) will never pick them up.

Net effect: for a "chill" query the system ranks a low-threshold vector match over documents that mostly lack vibe text, against a facets column that retrieval never reads. A high-energy party with a generic name outranks a genuinely relaxed event whose facets were never extracted or never embedded.

### What should be done

- **Fix the data first (see issue 3):** get the backlog enriched so `facets` and bilingual descriptions exist; then re-embed rows whose facets changed after embedding. Concretely: drop or scope the "Phase 5 forbids re-embed" rule in `enrichSingleEvent`'s facets-only path (re-embed when facets were empty and are now non-empty — the document builder `buildSearchDocument` in `src/shared/lib/ai/embeddings.ts` already renders facets as "Vibes: …, Energy: …" phrases), or bump `CURRENT_EMBEDDING_VERSION` and run `scripts/reembed-stale.ts`.
- **Make vibe a first-class retrieval signal:** extend `match_events_with_venues_filtered` / `lexical_match_events_with_venues` with a `filter_vibes`/`filter_energy` predicate mirroring the existing `filter_avoid_genres` pattern, and map "chill"/"tranquilo" → `vibes: ['relaxed']`, `energy: 'low'` at the intent layer (as `prefer`/soft rerank or a hard filter when the user is explicit). The `EventSearchPrefer.vibes` field already exists in `search-intent.ts` — it just currently only feeds query text.
- **Reconsider the 0.2 floor** for short vibe queries, or add a facet-aware rerank between `hybridEventSearch` and the `slice(0, displayLimit)` in `search-events.ts`.

### What should NOT be done

- Do **not** add regex/string scoring for "chill" inside `canonicalizeSearchIntent` — that module's documented contract forbids subjective scoring there, and prompt-side hacks won't fix missing data.
- Do **not** just tweak the concierge prompt wording — retrieval, not phrasing, is the failure.
- Do **not** bulk-update `facets` without re-embedding; facets that never reach `search_document`/`embedding` change nothing for vector or lexical search.
- Do **not** crank `match_threshold` globally as the only fix — it will starve legitimate sparse-document matches elsewhere.

---

## 2. Guest-chat persistence

### Real code path

- **Write path:** `src/features/chat/components/ChatContainer.svelte` → `persistMessageResiliently` (~line 281): `if (!isAuthenticated) { await addGuestMessage(...) }` — a pure IndexedDB write via `src/shared/lib/db/guest-conversations.ts` (Dexie DB `ba-events-guest-conversations`). No network call, no Supabase row. Authenticated users instead go through `persistMessageWithOutbox` (`src/features/chat/lib/persistence-outbox.ts`) → `chatState.addMessage` → `messages.remote.ts` → `messages.server.ts`, which `throw new Error('Not authenticated')` without a user (~line 50).
- **Read path:** `src/routes/chat/[conversationId]/+page.server.ts`: `if (!event.locals.user) { return { conversation: null } }` — the server never resolves guest conversations; the client then reads Dexie via `chatState.getGuestConversation` (`src/features/chat/state/chat.svelte.ts:166` → `getGuestConversationWithMessages`).
- The guest-conversations module header states the design outright: *"Guests have no server record, so their chats are stored in IndexedDB … resolvable on the same browser … but not on another device."*

### Root cause

This is architectural, not a bug in one function:

1. **The schema permits but the policies forbid guest rows.** `supabase/migrations/20260128000001_add_conversations.sql` makes `conversations.user_id` nullable (`user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE`, line 7), but every RLS policy is `auth.uid() = user_id` (lines 54-105), so an anonymous client can neither insert nor select a `user_id IS NULL` conversation. The server-side API reinforces this: `createConversation`/`addMessage` in `conversations.server.ts` / `messages.server.ts` throw `Not authenticated` when `supabase.auth.getUser()` returns null.
2. **Every persistence affordance is gated on `isAuthenticated`.** Even the resiliency layer — the IndexedDB outbox (`src/shared/lib/db/local-outbox.ts`) and its flush (`ChatContainer.svelte` `flushOutboxNow`, ~line 303) — returns early for guests: `if (!isAuthenticated || isFlushingOutboxRef) return`.
3. **There is no identity bridge.** No `signInAnonymously`, no guest-token cookie, and no claim/merge flow on login (grep for claim/merge/anonymous across `src/features/auth` and `src/features/chat`: nothing). So even the "upgrade a guest chat to an account" path doesn't exist.

Consequences match the report exactly: a `/chat/<id>` URL is a client-generated UUID resolvable only in the originating browser's Dexie store; other devices/browsers get the `conversation: null` shell ("not found"); and there are zero rows in `conversations`/`messages` to diagnose guest behavior — the only server trace is `trackServer(..., 'anonymous', ...)` analytics events in `src/routes/api/chat/+server.ts`.

### What should be done

Pick one identity strategy and implement it end to end:

- **Preferred: Supabase anonymous sign-in.** Call `supabase.auth.signInAnonymously()` on first guest chat, giving the guest a real `auth.users` row and `user_id`. The entire existing pipeline then works unmodified — `conversations`/`messages` inserts, RLS (`auth.uid() = user_id` holds), the remote functions, and the outbox. Add a claim-on-signup step (link the anonymous identity via `updateUser`/identity linking) so guest history survives registration. This is the smallest delta because no new tables, endpoints, or RLS exceptions are needed.
- **Alternative: a server-side guest store.** A `guest_conversations`/`guest_messages` pair keyed by the client UUID, written through a service-role endpoint with rate limiting + Turnstile-style abuse protection, plus a `+page.server.ts` branch that loads guest conversations server-side by id, plus a claim flow that re-parents rows to `user_id` on login. More surface area, more abuse vectors.
- Either way, extend `persistMessageResiliently`/`flushOutboxNow` so guests get the same outbox resiliency instead of the current fire-and-forget Dexie write.

### What should NOT be done

- Do **not** relax RLS on `conversations`/`messages` to `USING (true)` or allow `user_id IS NULL` inserts from the anon key — that makes every conversation publicly readable/writable by id.
- Do **not** proxy guest writes through the service-role key without an abuse/rate-limit story; chat writes are unbounded content.
- Do **not** keep dual persistence (Dexie + Supabase) as a permanent state — sync conflicts with no canonical store will be worse than today's limitation. IndexedDB can remain a cache, not the source of truth.
- Do **not** paper over the symptom with analytics logging of guest messages; the ask is URL portability and diagnosability, which requires real rows.

---

## 3. Enrichment backlog

### Real code path

`enrichmentCatchup` (scheduled, `0 10 * * *` America/Buenos_Aires) → `enrichmentBatch` (chained, up to `maxBatches: 20` × `BATCH_SIZE: 50`) — `src/trigger/jobs/enrichment-catchup.ts`. Selection is `getEventsForCatchup` (~line 29):

```ts
.from('events')
.select('id, name, link, source, categories, venue_id')
.in('enrichment_status', ['pending', 'failed'])
.not('link', 'is', null)
.order('starts_at', { ascending: true })
.limit(limit)
```

`getPendingCount` uses the same filters. Each batch calls `enrichEvents` → `enrichSingleEvent` (`src/features/import/core/event-enrichment.ts`), then chains to the next batch while `remainingCount > 0`.

### Root cause

Three selection/lifecycle defects interlock:

1. **No future-event filter and oldest-first ordering.** `getEventsForCatchup` has no `starts_at >= now` predicate and orders `starts_at ascending`, so long-expired events sort to the front of every batch, every day. `getEventsNeedingEnrichment` in `event-enrichment.ts` (used by the `enrich-events` job) has the same ascending-`starts_at`-with-no-floor shape.
2. **Passline events can never succeed server-side and are never marked as such.** `enrichSingleEvent` returns early for `adapter?.config.requiresClientSide` (`event-enrichment.ts` ~line 212) with `success: false, error: 'passline requires client-side extraction'` — **without writing anything to the row**. `enrichment_status` stays `'pending'` forever. The Passline adapter is hard-flagged `requiresClientSide: true` ("Cloudflare blocks server-side requests", `src/features/import/adapters/enrichment/passline-enrichment.ts:29`), and its client-side methods (`extractDescriptions`/`extractVenues` → `extractPasslineEventsBatchClient`) have **no caller anywhere in this repo** — the registry exposes them (`registry.ts`) but no admin route or job invokes them. So every pending Passline event is permanently eligible and permanently unenrichable.
3. **Terminal states are recycled.** The 404/410 handler sets `status: 'canceled'` **and** `enrichment_status: 'failed'` (`event-enrichment.ts` catch block); the catchup query selects `'failed'` and does not filter `status`, so canceled events are re-fetched, re-404, and re-marked every day. Generic failures also land on `'failed'` with no attempt counter or backoff — infinite daily retries.

The chaining logic turns this into a treadmill: because the query is deterministic (same filters, same order), batch N+1 selects **the same 50 expired/Passline/canceled rows** batch N just failed on; `remainingCount` never drops; the run burns all 20 batches (up to 1,000 event-attempts at 1s+ delay each, plus Jina/translation API calls for non-Passline rows) reprocessing the head of the queue. Future events — later `starts_at` — sit behind the dead rows, stay `pending`, and keep `description_es`/`description_en` null (Passline imports them null, transformer line 49), which is exactly the "future events pending and descriptions missing" symptom, and feeds issue 1's missing vibe data.

### What should be done

In `getEventsForCatchup` / `getPendingCount` (and align `getEventsNeedingEnrichment`):

- Add `.gte('starts_at', now)` (small grace if desired) so expired events leave the queue; separately, decide whether past events should be bulk-marked (e.g. `enrichment_status: 'skipped'` or a terminal status) instead of lingering as `pending`.
- Add `.neq('status', 'canceled')` and make the 404 path terminal — set `enrichment_status` to a terminal value the selector excludes (e.g. keep `'failed'` out of the catchup `.in()` list, or introduce `'canceled'`/`'skipped'`).
- Exclude client-side sources from server jobs: either filter `source != 'passline'` in the catchup selection, or (better) have `enrichSingleEvent`'s `requiresClientSide` early-return write a terminal marker so the row exits the queue. Separately, wire the existing Passline client-side enrichment (`passline-enrichment.ts` `extractDescriptions`/`extractVenues`) into an actual runnable path (admin browser flow or a browser-based worker) — the code exists and is currently dead.
- Add retry hygiene: an `enrichment_attempts` counter (or a `failed`-with-max-attempts rule) so chronic failures stop being reselected; order the queue by soonest **upcoming** `starts_at` so future events are enriched before they happen.

### What should NOT be done

- Do **not** raise `BATCH_SIZE`/`maxBatches` or the 1-hour `maxDuration` — that only makes the treadmill more expensive; the queue head never advances.
- Do **not** delete expired `pending` events to shrink the count — they are legitimate historical rows; exclude them from the selection instead.
- Do **not** mark `requiresClientSide` rows as `'failed'` without also removing `'failed'` from the selector — otherwise the same rows are reselected daily under a different label.
- Do **not** attempt server-side Passline scraping anyway (rotate proxies/headless fetch against Cloudflare) — the adapter documents why that path was abandoned; enrich Passline client-side or accept it as unavailable and mark it terminally.

---

## Recommended sequence

1. **Issue 3 (enrichment backlog) first.** It is a pure data-pipeline fix with no product decisions, and it is upstream of issue 1: until expired/canceled/client-side rows stop clogging the queue, future events keep null descriptions and empty facets, and no retrieval tuning will fix "chill". Land the selector fixes (`starts_at` floor, canceled exclusion, terminal status for `requiresClientSide`, retry cap) and wire or formally retire the Passline client-side path.
2. **Issue 1 (chill recommendations) second**, immediately after the backlog drains: re-embed rows whose facets were backfilled (drop the "Phase 5 forbids re-embed" rule or bump `CURRENT_EMBEDDING_VERSION` + `scripts/reembed-stale.ts`), then add facet-aware vibe retrieval (`filter_vibes`/`filter_energy` on the two RPCs, "chill"→`relaxed`/`energy:low` mapping). Validate with the existing harness — `evals/search/relevance/queries.ts` already has "chill" graded queries and a corpus with `vibe: "chill"` fixtures.
3. **Issue 2 (guest-chat persistence) last.** It is the largest and the only one requiring a product/security decision (anonymous auth vs. guest tables, claim flow, abuse protection). It is independent of 1 and 3, so it can be designed while the data fixes bake, but it should not block them.

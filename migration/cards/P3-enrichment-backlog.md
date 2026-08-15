# Card P3 — enrichment backlog

## Objective

Stop the daily catch-up from reprocessing dead Passline / expired / canceled
events so upcoming events get descriptions. Then try Passline detail enrichment
via Browserbase (the list scrape already uses it).

## Root cause (verified)

`getEventsForCatchup` / `getPendingCount` (`src/trigger/jobs/enrichment-catchup.ts`)
and `getEventsNeedingEnrichment` (`src/features/import/core/event-enrichment.ts`)
select `pending|failed`, order `starts_at ASC`, with no now-floor, no status
filter, no source filter.

`enrichSingleEvent` early-returns for `adapter.config.requiresClientSide`
(Passline) **without writing the row**, so those rows stay `pending` forever.

404s set `status: 'canceled'` + `enrichment_status: 'failed'` and are selected
again.

## Required changes

### 1. Queue selection (all three query functions)

Apply the same filters in:

- `getEventsForCatchup`
- `getPendingCount`
- `getEventsNeedingEnrichment`

Must:

- `.gte('starts_at', now - 12 hours)` (keep tonight’s already-started events)
- `.neq('status', 'canceled')` (and do not select `status = 'past'` if that
  column is used)
- `.in('enrichment_status', ['pending', 'failed'])` — **exclude** `skipped`
  and `completed`
- still require `link` not null
- still order `starts_at` ascending (soonest upcoming first)

`failed` stays retryable. `skipped` does not.

### 2. Terminal `skipped` status

Add `'skipped'` to the Postgres `enrichment_status` enum **and**
`ENRICHMENT_STATUSES` in `src/shared/lib/types.ts`.

Migration: `supabase/migrations/20260815160000_enrichment_skipped_status.sql`

```sql
ALTER TYPE enrichment_status ADD VALUE IF NOT EXISTS 'skipped';
```

Use `skipped` (not `failed`) when:

- `requiresClientSide` and Browserbase enrichment is unavailable / not attempted
- a source is permanently ineligible for the server job

404/410 path: keep `status: 'canceled'`. Change `enrichment_status` from
`failed` to `skipped` so even if a canceled filter is missed, catchup will not
reselect it.

### 3. Passline `requiresClientSide` early-return must write the row

Today (`event-enrichment.ts` ~211–218) it returns
`success: false, error: 'passline requires client-side extraction'` and writes
nothing.

New behavior:

1. If the adapter has `serverEnrich`, call it (do not early-return).
2. Else write `enrichment_status: 'skipped'` with
   `enrichment_error: '<source> requires client-side extraction'` and return
   `success: true, enriched: false` (counts as skipped, not failed).

### 4. Passline Browserbase `serverEnrich`

List scrape already uses `fetchPasslineEventsWithBrowserbase`
(`src/features/import/scrapers/passline/browser-scraper.ts`).

Add `serverEnrich` on `passlineEnrichmentAdapter`:

- If `isBrowserbaseAvailable()`: open a Browserbase session (reuse
  `createBrowserbaseSession`), connect Playwright over CDP, call the existing
  `fetchPasslineDescriptionFromDetailPage` in
  `src/features/import/scrapers/passline/description-enrichment.ts`.
  Return `{ description_es, description_en: null, venue_name }` so the rest of
  `enrichSingleEvent` translates + facets + embeds as usual.
- If Browserbase is not configured, or the session/page fails with a Cloudflare
  challenge: do **not** spin. Return null / throw a typed error that the
  early-return / catch path marks `skipped` (not `failed`).
- Set `requiresClientSide: false` **only if** `serverEnrich` is implemented
  and is the path `hasServerEnrichment` uses. Prefer: keep the client extractors
  for the unused admin path, set `requiresClientSide: false`, implement
  `serverEnrich`. `hasServerEnrichment` is `!requiresClientSide && serverEnrich`.

Do **not** launch local Playwright Chromium in Trigger jobs (datacenter IP).
Browserbase only.

### 5. Re-embed when facets-only backfill produces non-empty facets

The facets-only path in `enrichSingleEvent` (~174–202) currently forbids
re-embed. That leaves vibe tags invisible to search.

Change: if extracted facets are non-empty (`!isEmptyFacets(facets)`), also
rebuild `search_document` + embedding via `embedEventWithDocument` (same
builder as the full path) and write those columns + `embedding_version`.
If extracted facets are empty, keep the current facets-only write (no embed).

Update `event-enrichment.test.ts`: the “does NOT embed” case must now expect
an embed when the mock returns non-empty facets. Add a case that empty facets
still skip embed.

## Do not

- Raise `BATCH_SIZE` / `maxBatches`.
- Delete expired events.
- Mark Passline `failed` while `failed` is still selected.
- Add dependencies.
- Run `git` or `vite dev`.
- Touch chat UI or search ranking (other cards).

## Acceptance

1. Unit tests for selection helpers (extract the filter-building if needed) OR
   for `enrichSingleEvent`:
   - client-side source without `serverEnrich` writes `skipped`
   - 404 path writes `skipped` + `canceled`
   - facets-only + non-empty facets calls embed
   - facets-only + empty facets does not embed
2. `bunx vitest run src/features/import/core/event-enrichment.test.ts` passes
   (update existing tests that encoded the old “never re-embed” rule).
3. `bunx tsc --noEmit` — zero errors in files you touched.
4. Evidence: `migration/evidence/P3-enrichment-backlog.md` with the new query
   filters quoted, the Passline `serverEnrich` decision, and the re-embed rule.

## Boundaries

`src/features/import/**`, `src/trigger/jobs/enrichment-catchup.ts`,
`src/trigger/jobs/enrich-events.ts` (only if it needs the same filter),
`src/shared/lib/types.ts` (`ENRICHMENT_STATUSES` only),
`supabase/migrations/20260815160000_enrichment_skipped_status.sql`,
tests next to those files, evidence file.

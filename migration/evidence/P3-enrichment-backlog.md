# P3 — enrichment backlog — evidence

Card: `migration/cards/P3-enrichment-backlog.md`
Worker: `P3-enrichment-backlog`

## Summary

The daily catch-up now only selects upcoming `pending|failed` events (12h
floor, `canceled`/`past` excluded), terminal `skipped` is a first-class
`enrichment_status`, Passline enriches server-side through Browserbase (not the
local datacenter Playwright), and the facets-only backfill re-embeds whenever it
extracts non-empty facets.

Files touched (all within the card's boundaries):

- `src/features/import/core/event-enrichment.ts`
- `src/features/import/core/event-enrichment.test.ts`
- `src/features/import/adapters/enrichment-types.ts` (`EnrichmentSkippedError`)
- `src/features/import/adapters/enrichment/passline-enrichment.ts`
- `src/trigger/jobs/enrichment-catchup.ts`
- `src/shared/lib/types.ts` (`ENRICHMENT_STATUSES`)
- `supabase/migrations/20260815160000_enrichment_skipped_status.sql`

## 1. Queue selection filters (all three query functions)

Shared floor helper (`event-enrichment.ts`):

```ts
const ENRICHMENT_FLOOR_HOURS = 12

export function enrichmentStartsAtFloor(now: Date = new Date()): string {
  return new Date(
    now.getTime() - ENRICHMENT_FLOOR_HOURS * 60 * 60 * 1000
  ).toISOString()
}
```

`getEventsForCatchup` / `getPendingCount` (`enrichment-catchup.ts`) and
`getEventsNeedingEnrichment` (`event-enrichment.ts`) now all apply:

```ts
.in('enrichment_status', ['pending', 'failed'])
.neq('status', 'canceled')
.neq('status', 'past')
.gte('starts_at', enrichmentStartsAtFloor())
.not('link', 'is', null)
.order('starts_at', { ascending: true })
```

- `failed` stays retryable; `skipped` and `completed` are excluded.
- `link IS NOT NULL` and `starts_at ASC` are preserved.
- The old facets-backfill `or('enrichment_status.eq.pending,facets.eq.{},facets.is.null')`
  in `getEventsNeedingEnrichment` was removed — that clause was reselecting every
  already-completed event with empty facets and clogging catch-up.

## 2. Terminal `skipped` status

- `src/shared/lib/types.ts`: `ENRICHMENT_STATUSES` now ends in `'failed', 'skipped'`.
- Migration `supabase/migrations/20260815160000_enrichment_skipped_status.sql`:

```sql
ALTER TYPE enrichment_status ADD VALUE IF NOT EXISTS 'skipped';
```

`enrichment_status` update sites now use `skipped` (not `failed`) for:

- client-side-only source with no `serverEnrich` (terminal for the server job)
- `EnrichmentSkippedError` (Browserbase not configured / Cloudflare challenge /
  clean Passline page with no description)
- 404/410 pages (still `status: 'canceled'`, but `enrichment_status: 'skipped'`)

## 3. Passline requiresClientSide early-return now writes the row

`enrichSingleEvent` no longer early-returns silently for `requiresClientSide`.
New behavior:

```ts
if (adapter?.config.requiresClientSide && !adapter.serverEnrich) {
  await updateEventEnrichment(client, id, {
    enrichment_status: 'skipped',
    enrichment_error: `${source} requires client-side extraction`,
  })

  return { eventId: id, success: true, enriched: false }
}
```

An adapter that declares `requiresClientSide` **and** implements `serverEnrich`
falls through to the normal enrichment path (counts as skipped when ineligible,
not failed).

## 4. Passline Browserbase `serverEnrich` decision

`passline-enrichment.ts`:

- `config.requiresClientSide` changed `true` → `false` (so `hasServerEnrichment`
  is `!requiresClientSide && serverEnrich` = true).
- `serverEnrich` implemented: if `isBrowserbaseAvailable()` is false it throws
  `EnrichmentSkippedError` immediately (no spin). Otherwise it reuses
  `createBrowserbaseSession` + `chromium.connectOverCDP`, calls the existing
  `fetchPasslineDescriptionFromDetailPage`, and returns
  `{ description_es, description_en: null, venue_name }` (venue_name parsed from
  the same page's JSON-LD `location.name` when `extractVenue` is requested).
- Null-description outcomes are mapped to terminal `skipped` when the helper
  reports no error (clean page, no description) or a Cloudflare error; transient
  fetch errors are rethrown as ordinary errors so the row stays `failed`
  (retryable).
- Client extractors (`extractDescriptions` / `extractVenues`) are retained for
  the unused admin path. No local Playwright Chromium is launched in the Trigger
  job — Browserbase only.

The catch path in `enrichSingleEvent` recognizes `EnrichmentSkippedError`:

```ts
if (error instanceof EnrichmentSkippedError) {
  await updateEventEnrichment(client, id, {
    enrichment_status: 'skipped',
    enrichment_error: error.message,
  })
  return { eventId: id, success: true, enriched: false, error: error.message }
}
```

## 5. Re-embed rule for facets-only backfill

If the facets-only path extracts non-empty facets (`!isEmptyFacets(facets)`), it
now rebuilds `search_document` + `embedding` via the same canonical
`embedEventWithDocument` builder as the full path (resolving the existing
`venue_id` name/neighborhood first) and writes `facets`, `embedding`,
`search_document`, `embedding_version`. If facets are empty it keeps the
previous facets-only write (no embed).

## 6. Acceptance checks (actually run)

### 1. `bunx vitest run src/features/import/core/event-enrichment.test.ts`

```
 RUN  v4.1.10 /Users/hanifcarroll/projects/ba-events

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  16:33:33
   Duration  916ms (transform 88ms, setup 0ms, import 823ms, tests 6ms, environment 0ms)
```

The five tests cover: facets-only + non-empty facets calls embed; present
embedding without `status=completed` still routes facets-only; facets-only +
empty facets does not embed; client-side-only source without `serverEnrich`
writes `skipped`; 404 path writes `skipped` + `canceled`.

### 2. `bunx tsc --noEmit`

Zero errors (no output, exit 0).

### 3. `bun run check` (svelte-check)

```
COMPLETED 6235 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

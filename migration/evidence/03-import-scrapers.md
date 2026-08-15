# Card 03 — import-scrapers — evidence

## Scope done

Ported all six source scrapers + shared scraper utilities from
`/Users/hanifcarroll/projects/ba-events/src/features/import/scrapers/**` to
`src/features/import/scrapers/**`. This is framework-agnostic Trigger.dev code, so the
port is 1:1 behavior with import-path rewriting (`@/shared/...` → `#shared/...ts`,
relative imports get explicit `.ts` extensions, `process.env.*` untouched).

38 files written:

- `src/features/import/scrapers/ai-categorizer.ts` — AI category inference (DeepSeek `generateObject`); imports → `#shared/lib/types.ts`, `#shared/lib/ai/providers.ts`.
- `src/features/import/scrapers/venue-matcher.ts` — venue exact/fuzzy match vs Supabase; `@/shared/lib/db/client` → `#shared/lib/db/client.server.ts` (per contract §4), types → `#shared/lib/types.ts`.
- `src/features/import/scrapers/shared/normalization.ts` — shared normalize helpers (no external imports).
- `src/features/import/scrapers/shared/blocklist-filter.ts` — blocklist filtering; types → `#shared/lib/types.ts`.
- `src/features/import/scrapers/ba-tourism/browser-scraper.ts` — local Playwright scraper; `logger` → `#shared/lib/logger.ts`, relative imports → `.ts`.
- `src/features/import/scrapers/ba-tourism/client.ts` — browser-context DOM extraction (relative imports → `.ts`).
- `src/features/import/scrapers/ba-tourism/date-parser.ts` — Spanish date/time parser; `BA_TIMEZONE` → `#shared/lib/constants.ts`.
- `src/features/import/scrapers/ba-tourism/enrichment.ts` — detail-page venue name fetch (no imports).
- `src/features/import/scrapers/ba-tourism/scraper.ts` — cheerio HTML scraper (relative imports → `.ts`).
- `src/features/import/scrapers/ba-tourism/transformer.ts` — transformer; types/date-parser/normalization rewritten.
- `src/features/import/scrapers/ba-tourism/types.ts` — types (no imports).
- `src/features/import/scrapers/eventbrite/api.ts` — JSON-LD listing scraper (no imports).
- `src/features/import/scrapers/eventbrite/detail.ts` — detail-page time/price/age extractor (no imports).
- `src/features/import/scrapers/eventbrite/enrichment.ts` — price + AI category enrichment; types/providers/errors rewritten.
- `src/features/import/scrapers/eventbrite/transformer.ts` — transformer; types/api/normalization/constants rewritten.
- `src/features/import/scrapers/eventbrite/transformer.test.ts` — tests; `./api`/`./transformer` → `.ts`.
- `src/features/import/scrapers/luma/api.ts` — Luma embedded-JSON scraper (relative imports → `.ts`).
- `src/features/import/scrapers/luma/description-enrichment.ts` — description enrichment; streaming-types/html-parsing rewritten.
- `src/features/import/scrapers/luma/transformer.ts` — transformer; types/constants/normalization rewritten.
- `src/features/import/scrapers/luma/types.ts` — types (no imports).
- `src/features/import/scrapers/luma/venue-enrichment.ts` — venue enrichment; streaming-types/html-parsing rewritten.
- `src/features/import/scrapers/meetup/browser-scraper.ts` — Playwright/Browserbase scraper; browser/constants/security/logger rewritten.
- `src/features/import/scrapers/meetup/date-parser.ts` — date/recurrence parser; constants rewritten.
- `src/features/import/scrapers/meetup/description-enrichment.ts` — description enrichment; streaming-types/html-parsing rewritten.
- `src/features/import/scrapers/meetup/transformer.ts` — transformer; types/date-parser/normalization rewritten.
- `src/features/import/scrapers/meetup/types.ts` — types (no imports).
- `src/features/import/scrapers/meetup/venue-enrichment.ts` — venue enrichment; html-parsing/logger rewritten.
- `src/features/import/scrapers/passline/address-enrichment.ts` — Playwright address enrichment; streaming-types/browser rewritten.
- `src/features/import/scrapers/passline/api.ts` — API client; `../shared` → `../shared/blocklist-filter.ts`, types rewritten.
- `src/features/import/scrapers/passline/browser-scraper.ts` — Browserbase API fetch; browser/logger/api rewritten.
- `src/features/import/scrapers/passline/client-enrichment.ts` — client-side enrichment (no imports).
- `src/features/import/scrapers/passline/client.ts` — client-side API fetch; `../shared` → `../shared/blocklist-filter.ts`, types/api rewritten.
- `src/features/import/scrapers/passline/description-enrichment.ts` — Playwright description enrichment; streaming-types/browser rewritten.
- `src/features/import/scrapers/passline/transformer.ts` — transformer; types/api/normalization/constants rewritten.
- `src/features/import/scrapers/passline/transformer.test.ts` — tests; `./api`/`./transformer` → `.ts`.
- `src/features/import/scrapers/venti/api.ts` — Venti API client; `../../core/nominatim` → `../../core/nominatim.ts` (cross-import debt, see below).
- `src/features/import/scrapers/venti/transformer.ts` — transformer; types/constants/normalization rewritten.
- `src/features/import/scrapers/venti/types.ts` — types (no imports).

No `.svelte` / `.svelte.ts` files were written → the svelte-autofixer gate is N/A.

## Commands + outputs

### 1. `bunx tsc --noEmit 2>&1`

```
src/features/import/scrapers/venti/api.ts(14,23): error TS2307: Cannot find module '../../core/nominatim.ts' or its corresponding type declarations.
src/shared/lib/types.ts(1,40): error TS2307: Cannot find module '#features/chat/api/tools/search-events.ts' or its corresponding type declarations.
```

Both are tolerated mid-wave:
- `venti/api.ts` — `import/core` is card 04's scope (not yet ported).
- `shared/lib/types.ts` — pre-existing cross-card import (`#features/chat/api/tools/...`), not owned by this card.

Zero errors in the other 37 files of this card.

### 2. `bunx vitest run src/features/import/scrapers`

```
 RUN  v4.1.10 /Users/hanifcarroll/projects/ba-events-sveltekit


 Test Files  2 passed (2)
      Tests  5 passed (5)
   Start at 12:54:01
   Duration  879ms (transform 77ms, setup 0ms, import 1.56s, tests 6ms, environment 0ms)
```

### 3. Forbidden-import grep

```
grep -rn "@tanstack\|from 'react'\|import.meta.env\|\$app/\|\$env/" src/features/import/scrapers
```

Output: empty (no matches).

## Deviations

- **Barrel index files not ported (8 files).** All were pure re-export barrels, which
  contract §1 forbids. Skipped and inventoried below so later import sites target the
  real modules: `scrapers/index.ts`, `shared/index.ts`, `ba-tourism/index.ts`,
  `eventbrite/index.ts`, `luma/index.ts`, `meetup/index.ts`, `passline/index.ts`,
  `venti/index.ts`.
- **`../shared` (barrel) → `../shared/blocklist-filter.ts`.** `passline/api.ts` and
  `passline/client.ts` imported `isBlockedByEntries` from the dropped `shared/index.ts`
  barrel; they now import the real file directly (contract §1 no barrels).
- **`@/shared/lib/browser` → `#shared/lib/browser/index.ts`.** Wave 1 already ported the
  legacy `browser/index.ts` barrel (same three re-export groups), so the 1:1 import-path
  rewrite resolves to the existing module rather than the individual `browser/*` files.
- No behavior changes, no silent bug fixes. The two `transformer.test.ts` files keep
  their original assertions.

## Cross-import debts

- `src/features/import/scrapers/venti/api.ts` imports `delay` from
  `../../core/nominatim.ts` — owned by card 04 (`import/core`), does not exist yet.
- `src/shared/lib/types.ts` (pre-existing, wave 1) imports
  `#features/chat/api/tools/search-events.ts` — owned by the chat cards, does not exist
  yet. Surfaced by `tsc` but not caused by this card.

## TODOs

None. No `@migration TODO:` annotations were needed — every file in scope was ported 1:1.

## Barrel inventory (what each skipped index re-exported)

### `scrapers/index.ts`
- namespaces: `passline`, `eventbrite`, `baTourism`, `meetup`, `luma`, `venti`
- `matchVenue`, `matchVenues`, `type VenueMatchResult` (from `./venue-matcher`)

### `scrapers/shared/index.ts`
- from `./normalization`: `normalizeTitle`, `normalizeDescription`, `normalizeUrl`,
  `normalizePrice`, `normalizeDateRange`, `generateExternalId`, `normalizeImageUrl`,
  `type NormalizedDateRange`
- from `./blocklist-filter`: `isBlockedByEntries`

### `scrapers/ba-tourism/index.ts`
- from `./scraper`: `fetchBATourismPage`, `parseBATourismEvents`, `extractWeekContext`,
  `scrapeBATourismEvents`
- from `./browser-scraper`: `scrapeBATourismEventsWithBrowser`
- from `./client`: `extractEventsFromDOM`, `extractWeekContextFromDOM`, `getExtractEventsScript`
- from `./transformer`: `transformBATourismEvent`, `transformBATourismEvents`, `getUniqueVenueNames`
- from `./date-parser`: `parseSpanishDate`, `parseWeekContext`, `toISODateTime`, `getEndTimeISO`
- from `./enrichment`: `extractBATourismVenueName`, `extractBATourismVenuesBatch`
- from `./types`: `type BATourismEvent`, `type Coordinates`, `type ParsedDateTime`,
  `type WeekContext`, `type BATourismCategory`, `BA_TOURISM_CATEGORIES`

### `scrapers/eventbrite/index.ts`
- from `./api`: `fetchEventbriteEvents`, `filterInPersonEvents`, `filterByDateRange`,
  `isOnlineEvent`, `getVenueName`, `getVenueAddress`, `extractEventId`,
  `type EventbriteEvent`, `type EventbriteLocation`, `type EventbriteAddress`,
  `type EventbriteGeoCoordinates`
- from `./transformer`: `transformEventbriteEvent`, `transformEventbriteEvents`,
  `extractVenueInfo`, `getVenueKey`, `getUniqueVenueNames`, `getAllVenueInfo`,
  `type EventbriteVenueInfo`
- (comment-only note: enrichment intentionally NOT re-exported — import directly from `./enrichment`)

### `scrapers/luma/index.ts`
- from `./types`: `type LumaEvent`, `type LumaVenue`, `type LumaHost`, `type LumaVenueInfo`
- from `./api`: `fetchLumaEvents`, `filterByDateRange`, `getVenueName`, `getVenueAddress`
- from `./transformer`: `transformLumaEvent`, `transformLumaEvents`, `extractVenueInfo`,
  `getVenueKey`, `getUniqueVenueNames`, `getAllVenueInfo`
- from `./description-enrichment`: `enrichLumaEventsWithDescriptions`,
  `enrichLumaDescriptionsBatch`, `fetchLumaDescriptionFromDetailPage`,
  `type LumaDescriptionResult`, `type EnrichmentEvent as LumaEnrichmentEvent`
- from `./venue-enrichment`: `enrichLumaEventsWithVenues`, `fetchLumaVenueFromUrl`,
  `type LumaVenueResult`, `type VenueEnrichmentEvent as LumaVenueEnrichmentEvent`

### `scrapers/meetup/index.ts`
- from `./browser-scraper`: `scrapeMeetupEvents`, `filterInPersonEvents`,
  `filterByDateRange`, `getExtractionScript`, `type ScraperOptions`
- from `./transformer`: `transformMeetupEvent`, `transformMeetupEventWithExpansion`,
  `transformMeetupEvents`, `getUniqueVenueNames`, `getUniqueGroupNames`
- from `./date-parser`: `parseMeetupDate`, `extractRecurrencePattern`, `isRecurringEvent`,
  `expandRecurringEvent`, `expandRecurringEventWithIds`, `parseMeetupDateTime`,
  `formatArgentinaDate`
- from `./venue-enrichment`: `fetchMeetupVenueFromUrl`, `enrichMeetupEventsWithVenues`,
  `type MeetupVenueInfo`, `type EnrichmentEvent`, `type EnrichmentResult`
- from `./description-enrichment`: `fetchMeetupDescriptionFromDetailPage`,
  `enrichMeetupEventsWithDescriptions`, `enrichMeetupDescriptionsBatch`,
  `type MeetupDescriptionResult`, `type DescriptionEnrichmentEvent`
- from `./types`: `type MeetupEvent`, `type MeetupGroup`, `type MeetupVenue`,
  `type MeetupCategory`, `type MeetupGraphQLEvent`, `type ParsedMeetupDateTime`,
  `MEETUP_CATEGORIES`

### `scrapers/passline/index.ts`
- from `./api`: `fetchPasslineEvents`, `filterCABAEvents`, `filterByDateRange`,
  `isSoldOut`, `type PasslineEvent`, `type DateRange`
- from `./client`: `fetchPasslineEventsClient`, `filterCABAEventsClient`, `filterByDateRangeClient`
- from `./transformer`: `transformPasslineEvent`, `transformPasslineEvents`

### `scrapers/venti/index.ts`
- from `./types`: `type VentiEvent`, `type VentiVenue`, `type VentiTicketAvailability`,
  `type VentiVenueInfo`
- from `./api`: `fetchVentiEvents`, `filterCABAEvents`, `fetchVentiTicketAvailability`,
  `fetchVentiAvailabilityBatch`
- from `./transformer`: `transformVentiEvent`, `mapVentiCategory`, `getAllVenueInfo`,
  `getVenueName`

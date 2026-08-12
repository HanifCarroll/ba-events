# Event Import Sources & Enrichment Process

> **2026-08-10:** The admin import wizard and all admin UI were removed — the site is operated
> exclusively through agents. Imports run automatically via the Trigger.dev daily scrape
> (`src/trigger/jobs/daily-scrape.ts` → `src/features/import/core/*.ts`), and enrichment runs
> automatically via the `enrich-events` job (`core/event-enrichment.ts`). See
> `docs/decisions.md` for the removal decisions.

This document outlines the event import architecture: automated initial import (daily scrape) followed by enrichment to fill in missing data.

## Import Sources Overview

| Source | Missing from Initial Import | Auto-Enrich Default |
|--------|----------------------------|---------------------|
| Passline | Descriptions | Yes |
| Eventbrite | Detail-page time/price/age verification | No |
| BA Tourism | Very little (most complete) | No |
| Meetup | Descriptions, venue details | Yes |
| Luma | Descriptions, venue details | Yes |
| Venti | Very little (descriptions + venues native; prices from availability API) | No |

## Source Details

### Passline

**Initial import captures:**
- Event name, venue name
- Dates and times (start/end)
- Price (min price)
- Event URL, images
- Artists, sold-out status
- Categories/vibes (inferred from Passline's event metadata)

Passline sometimes publishes `00:00` for both endpoints without a real time. Those
records keep their known date but set `time_tba = true`; the UI shows "Time TBA"
instead of presenting midnight as verified.

**Missing (requires enrichment):**
- Descriptions - must be scraped from individual event pages via Jina + Claude Haiku

### Eventbrite

**Initial import captures:**
- Event name, description (from JSON-LD)
- Venue name, full address, coordinates
- Dates (start/end) from listing JSON-LD
- Image URL, event URL

The importer then fetches each detail page before upsert to verify start/end times,
price, and minimum age. If a same-day listing has no verifiable detail-page start
time, it sets `time_tba = true`; chat tools and event cards show "Time TBA". Eventbrite
IDs are extracted from both `tickets-<id>` and `registration-<id>` URLs so registration
events follow the normal update path instead of being inserted repeatedly.

### BA Tourism

**Initial import captures:**
- Event name, description
- Category (from website)
- Free/paid indicator
- Venue name, neighborhood, address
- GPS coordinates (from Google Maps links)
- Dates (parsed from Spanish text)

**Missing:**
- Very little - this is the most complete source
- Venues may need matching to existing database entries

### Meetup

**Initial import captures:**
- Event name
- Dates/times, timezone
- Group name (organizer)
- Price (free/paid), attendee count
- Event URL, image
- Categories/vibes (mapped from Meetup's category system)
- Recurring event patterns (expanded to multiple dates)

**Missing (requires enrichment):**
- Descriptions - must be scraped from individual event pages via Jina + Claude Haiku
- Venue details - often null in list data, requires visiting individual event pages

### Venti

**Initial import captures:**
- Event name, Spanish description (native — no enrichment needed)
- Dates/times (UTC), category (party/concert/festival/gastronomy mapped to our categories)
- Venue with coordinates + Google Place ID (from the API)
- Price (ARS, from the per-event availability endpoint)
- Event URL, images, producer/org

**Missing:**
- Very little. ~22% of events have no description in Venti's own API (a source data
  limitation). English descriptions are produced by the translate-only enrichment fast path.

## Enrichment Strategy Decision Matrix

The following table documents the enrichment strategy for each source, along with the technical reasons for each decision.

| Source | Strategy | Reason | Description Method | Venue Method | Known Language |
|--------|----------|--------|-------------------|--------------|----------------|
| **Passline** | Server-side Playwright | Playwright bypasses CORS & Cloudflare | JSON-LD `description` field | JSON-LD `location.name` + DOM address patterns | Spanish (es) |
| **Meetup** | Server direct fetch | Jina Reader returns HTTP 451 | `__NEXT_DATA__` props | JSON-LD `@type: Place` | Variable (detect) |
| **Luma** | Server-side Playwright | Requires browser for JS content | `__NEXT_DATA__` or JSON-LD | `geo_address_json` or venue object | Variable (detect) |
| **BA Tourism** | Server-side (Jina + AI) | Works normally | Jina markdown → Haiku extraction | Regex after "¿Dónde?" heading | Spanish (es) |
| **Eventbrite** | Server-side (Jina + AI) | Works normally | Jina markdown → Haiku extraction | JSON-LD Event.location | Variable (detect) |

### Decision Factors

1. **Cloudflare/Bot Protection** → Use server-side browser automation (Playwright, or Browserbase for datacenter-IP-blocked sites)
2. **Jina Legal Restrictions (HTTP 451)** → Use direct fetch with browser headers
3. **Structured Data Available (JSON-LD, `__NEXT_DATA__`)** → Use direct extraction (no AI)
4. **Complex/Unstructured HTML** → Use AI extraction (Claude Haiku)
5. **Known Language (Spanish sources)** → Skip language detection

### Enrichment Adapter Architecture

Each source has an enrichment adapter in `src/features/import/adapters/enrichment/`:

```typescript
interface EnrichmentAdapter<TPreviewEvent> {
  source: ImportSource
  capabilities: { descriptions: boolean; venues: boolean }
  config: {
    requiresClientSide: boolean
    strategyReason: string
    knownLanguage?: 'es' | 'en'
    concurrency: number
    delayMs: number
  }

  // Client-side only
  extractDescriptions?(events, onProgress): Promise<DescriptionExtractionResult[]>
  extractVenues?(events, onProgress): Promise<VenueExtractionResult[]>

  // Server-side only
  serverEnrich?(link, options): Promise<ServerEnrichmentResult | null>

  getEnrichmentUrl?(event): string | null
}
```

Use `getEnrichmentAdapter(source)` to get the adapter for routing decisions.

## Enrichment Process

### Phase 1: Automated Import (Daily Scrape)

The Trigger.dev `daily-scrape` schedule (6 AM Buenos Aires) triggers one job per source
(`scrape-eventbrite`, `scrape-ba-tourism`, `scrape-meetup`, `scrape-luma`, `scrape-passline`,
`scrape-venti`). Each job runs its `process<Source>Import` in `src/features/import/core/`:

1. Fetch raw events from the source API (browser via Browserbase for Cloudflare-blocked sources)
2. Filter to CABA + blocklist
3. Settle venues (exact/fuzzy match, auto-create, or queue for review)
4. Check duplicates against existing `external_id`s (update vs. insert)
5. Transform to `EventInsert`; map native categories (AI fallback for unknown categories)
6. Generate embeddings + bilingual presentation fields
7. Upsert to the database

### Phase 2: Enrichment (Automated Job)

The `enrich-events` Trigger.dev job processes events with `enrichment_status = 'pending'` via
`core/event-enrichment.ts`:

- **Events that already have `description_es`** (native-description sources: BA Tourism,
  Eventbrite, Venti): **translate-only fast path** — `translateText(es, 'es-to-en')` without
  re-scraping the page, then regenerate embedding + presentation fields. (See the
  "Generic Translate-Only Enrichment" decision in `docs/decisions.md`.)
- **Events missing descriptions**: fetch the page (Jina Reader or source-specific adapter),
  extract with the LLM, detect language, and produce both `description_es` and `description_en`.
- **Events with no description at all** (e.g., 40 Venti events): marked `failed` — a source
  data limitation, not a scrape gap.

Eligibility: `enrichment_status = 'pending'` and `link` not null.

## Automated Enrichment Job

The `enrich-events` Trigger.dev job (triggered after each daily scrape and manually via
`tasks.trigger('enrich-events')`) processes pending events through the shared enrichment
pipeline in `src/features/import/core/event-enrichment.ts`. There is no admin UI for this —
agents trigger it or rely on the daily schedule.

### Source-to-Strategy Routing

The daily enrichment job routes each source through its enrichment adapter
(`src/features/import/adapters/enrichment/`):

| Source | Strategy | Reason |
|--------|----------|--------|
| `passline` | Client-side only (skipped by the job) | Cloudflare blocks server-side requests |
| `luma` | Server direct fetch | Requires browser for JS content |
| `meetup` | Server direct fetch | Jina Reader returns HTTP 451 |
| `eventbrite` | Server-side Jina + AI | Works normally |
| `ba-tourism` | Server-side Jina + AI | Works normally |
| `venti` | Translate-only fast path | Descriptions arrive natively in the API |

### Adding a New Source

1. Add a scraper (`src/features/import/scrapers/<source>/`) and a core pipeline
   (`src/features/import/core/<source>.ts`) following `core/venti.ts` as the template.
2. Register the Trigger.dev job in `src/trigger/jobs/scrape-<source>.ts` and add it to
   `daily-scrape.ts` `SOURCE_JOBS`.
3. Add an enrichment adapter in `adapters/enrichment/<source>-enrichment.ts` (with
   `serverEnrich` for server-fetchable sources) and register it in the enrichment registry.
4. Add the source to `ImportSource` (`adapters/types.ts`), `SCRAPE_RUN_SOURCES` +
   `BLOCKLIST_SOURCES` (`shared/lib/types.ts`), and `SOURCE_LABELS`
   (`events/lib/source-presentation.ts`).

### Key Files

```
src/features/import/
├── adapters/
│   ├── types.ts                # ImportSource type
│   ├── enrichment-types.ts     # EnrichmentAdapter interface
│   └── enrichment/             # Enrichment adapter registry + per-source adapters
├── scrapers/
│   ├── venue-matcher.ts        # Venue matching logic
│   ├── passline/               # Passline scraper + Browserbase + enrichment
│   ├── eventbrite/             # Eventbrite scraper + enrichment
│   ├── meetup/                 # Meetup scraper + enrichment
│   ├── luma/                   # Luma scraper + enrichment
│   ├── ba-tourism/             # BA Tourism scraper
│   └── venti/                  # Venti API scraper (catalog + availability)
├── core/
│   ├── venti.ts                # Venti import pipeline (template for new sources)
│   ├── event-enrichment.ts     # Batch enrichment orchestration (translate-only fast path)
│   ├── venue-review.ts         # Venue review approve/reject/merge (agent-callable)
│   └── venue-settlement.ts     # Venue matching/creation
└── api/
    └── duplicate-detection.ts  # External-ID dedupe shared by all sources

src/trigger/jobs/
├── daily-scrape.ts             # 6 AM orchestrator (all sources)
├── scrape-<source>.ts          # One job per source
└── enrich-events.ts            # Enrichment job

src/shared/lib/
├── ai/
│   ├── enrichment.ts           # Jina + LLM description extraction, translation
│   └── embeddings.ts           # OpenAI embedding generation
└── browser/                    # Browser automation utilities (Browserbase, Cloudflare)
```

## Browser Automation Architecture

Several scrapers use browser automation (Playwright) to fetch data from sites with bot protection (Cloudflare) or heavy JavaScript rendering.

### Browserbase (cloud browser for IP-blocked sites)

Sites that block datacenter IPs (Passline, Meetup) scrape through **Browserbase** cloud
browser sessions (`src/shared/lib/browser/browserbase.ts`): sessions egress through a
managed residential proxy with captcha solving. Used when `BROWSERBASE_API_KEY` is set.

### Local Playwright (default path)

Other scrapers (BA Tourism, Passline enrichment) launch **local Playwright + Chromium**
directly. In Trigger.dev production jobs, Chromium is bundled by the `playwright` build
extension in `trigger.config.ts`.

### Cloudflare Handling

When a Cloudflare challenge is detected:
1. Wait 5-8 seconds for Turnstile auto-resolve
2. Retry up to 3 times
3. Check for success selector (e.g., `#segundo_contenedor` for Passline)

Detection indicators:
- `__cf_chl` - Cloudflare challenge token
- `challenge-platform` - Challenge platform indicator
- `turnstile` - Turnstile CAPTCHA

### Shared Browser Utilities

Common browser automation code is centralized in `src/shared/lib/browser/`:

```
src/shared/lib/browser/
├── index.ts          # Public API exports
├── browserbase.ts    # Browserbase cloud browser session helpers
├── cloudflare.ts     # Cloudflare challenge detection
└── constants.ts      # User-agent, viewport, launch args
```

**Usage:** scrapers launch Playwright directly (`chromium.launch()`) and use
`isCloudflareChallenge` to detect challenge pages. Sites that block datacenter
IPs (Passline, Meetup) connect to a Browserbase cloud browser instead:

```typescript
import { isCloudflareChallenge } from '@/shared/lib/browser'

const html = await page.content()
if (isCloudflareChallenge(html)) {
  // Retry after Turnstile auto-resolve, or treat as blocked
}
```

For Browserbase sessions (Meetup, Passline):

```typescript
import { isBrowserbaseAvailable, createBrowserbaseSession } from '@/shared/lib/browser'

if (isBrowserbaseAvailable()) {
  const { sessionId, connectUrl } = await createBrowserbaseSession()
  const browser = await chromium.connectOverCDP(connectUrl)
  // ... scrape, then:
  await browser.close()
}
```

Playwright itself is a direct dependency of each scraper; the shared module
does not wrap it.

### Browser Scrapers

| File | Source | Purpose |
|------|--------|---------|
| `scrapers/passline/description-enrichment.ts` | Passline | Extract event descriptions |
| `scrapers/passline/address-enrichment.ts` | Passline | Extract venue addresses |
| `scrapers/meetup/browser-scraper.ts` | Meetup | Scrape events by date range |
| `scrapers/ba-tourism/browser-scraper.ts` | BA Tourism | Scrape tourism portal events |

## Valid Categories & Vibes

**Categories:** techno, house, electronic, jazz, rock, indie, latin, tango, classical, hip-hop, reggaeton, folk, art, theatre, comedy, film, food, market, festival, workshop, networking, sports, other

**Vibes:** underground, mainstream, chill, high-energy, romantic, family-friendly, lgbtq-friendly, expat-friendly, local, touristy, intimate, massive, outdoor, rooftop

## Key Files

See the "Key Files" section under "Automated Enrichment Job" above — the admin import
wizard, SourceAdapters, and admin enrichment hooks were removed (2026-08-10, see
`docs/decisions.md`).

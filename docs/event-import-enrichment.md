# Event Import Sources & Enrichment Process

> **2026-08-10:** The admin import wizard and all admin UI were removed — the site is operated
> exclusively through agents. Imports run automatically via the daily scrape Workflow in the
> `baeventos-jobs` Worker (`src/jobs-worker/index.ts` → `src/features/import/core/*.ts`), and
> enrichment runs in the same Workflow and the 10:00 catch-up (`core/event-enrichment.ts`). See
> `docs/decisions.md` for the removal decisions.
>
> **2026-11-15:** The jobs moved from Trigger.dev to Cloudflare, and the Passline, Eventbrite,
> and Venti scrapers were removed. Events they imported stay in the catalog and age out.

This document outlines the event import architecture: automated initial import (daily scrape) followed by enrichment to fill in missing data.

## Import Sources Overview

| Source | Missing from Initial Import | Auto-Enrich Default |
|--------|----------------------------|---------------------|
| BA Tourism | Very little (most complete) | No |
| Meetup | Descriptions, venue details | Yes |
| Luma | Descriptions, venue details | Yes |

## Source Details

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

## Enrichment Strategy Decision Matrix

The following table documents the enrichment strategy for each source, along with the technical reasons for each decision.

| Source | Strategy | Reason | Description Method | Venue Method | Known Language |
|--------|----------|--------|-------------------|--------------|----------------|
| **Meetup** | Server direct fetch | Jina Reader returns HTTP 451 | `__NEXT_DATA__` props | JSON-LD `@type: Place` | Variable (detect) |
| **Luma** | Luma JSON API | luma.com HTML is rate-limited for Cloudflare Workers | `/event/get` `description_mirror` | `/event/get` `geo_address_info` (public only; `obfuscated` sets `location_hidden` and no venue) | Variable (detect) |
| **BA Tourism** | Server-side (Jina + AI) | Works normally | Jina markdown → Haiku extraction | Regex after "¿Dónde?" heading | Spanish (es) |

### Decision Factors

1. **JavaScript-rendered listings** → Use Cloudflare Browser Rendering from the jobs Worker
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

The `baeventos-daily-scrape` Workflow (6 AM Buenos Aires) runs one retried step per source
(Meetup, BA Tourism, Luma), concurrently, then finalizes after all have settled. Each step runs its `process<Source>ImportEffect` in
`src/features/import/core/`:

1. Fetch raw events from the source (Cloudflare Browser Rendering for Meetup and BA Tourism)
2. Filter to CABA + blocklist
3. Settle venues (exact/fuzzy match, auto-create, or queue for review)
4. Check duplicates against existing `external_id`s (update vs. insert)
5. Transform to `EventInsert`; map native categories (AI fallback for unknown categories)
6. Generate embeddings + bilingual presentation fields
7. Upsert to the database

### Phase 2: Enrichment (Automated Job)

The daily scrape Workflow then enriches the events it created, in sequential `enrich batch N`
steps, via `core/event-enrichment.ts`:

- **Events that already have `description_es`** (native-description sources such as BA
  Tourism): **translate-only fast path** — `translateText(es, 'es-to-en')` without
  re-scraping the page, then regenerate embedding + presentation fields. (See the
  "Generic Translate-Only Enrichment" decision in `docs/decisions.md`.)
- **Events missing descriptions**: fetch the page (Jina Reader or source-specific adapter),
  extract with the LLM, detect language, and produce both `description_es` and `description_en`.
- **Events with no description at all**: marked `failed` — a source data limitation, not a
  scrape gap.

Eligibility: `enrichment_status = 'pending'` and `link` not null, from a source other than the
retired `passline`, `eventbrite`, and `venti`. Imports arrive `pending` with an embedding; they take
the full path (reusing the stored description) and are written `completed`, so they leave the queue.
Only `completed` rows get the facets-only backfill.

## Automated Enrichment Job

The daily scrape Workflow's enrichment steps, and the `baeventos-enrichment-catchup` Workflow
(10:00 Buenos Aires, also started by hand with `wrangler workflows trigger
baeventos-enrichment-catchup --config wrangler.jobs.jsonc`), process pending events through the
shared enrichment pipeline in `src/features/import/core/event-enrichment.ts`. There is no admin
UI for this.

### Source-to-Strategy Routing

The daily enrichment job routes each source through its enrichment adapter
(`src/features/import/adapters/enrichment/`):

| Source | Strategy | Reason |
|--------|----------|--------|
| `luma` | Luma JSON API (`/event/get`) | luma.com HTML is rate-limited (429) for Cloudflare Workers |
| `meetup` | Server direct fetch | Jina Reader returns HTTP 451 |
| `ba-tourism` | Server-side Jina + AI | Works normally |
| `instagram` | Generic Jina + AI | No adapter; stored descriptions use the translate-only path |
| `passline`, `eventbrite`, `venti` | Not enriched | Retired sources (`RETIRED_SOURCES`); their events are excluded from selection and counts and age out |

### Adding a New Source

1. Add a scraper (`src/features/import/scrapers/<source>/`) and a core pipeline
   (`src/features/import/core/<source>.ts`) following `core/luma.ts` as the template.
2. Add it to `SOURCES` in `src/jobs-worker/source-health.ts` and to `importSource` and
   `readSourceCatalog` in `src/jobs-worker/sources.ts`.
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
│   ├── meetup/                 # Meetup scraper + enrichment
│   ├── luma/                   # Luma scraper + enrichment
│   └── ba-tourism/             # BA Tourism scraper
├── core/
│   ├── luma.ts                 # Luma import pipeline (template for new sources)
│   ├── event-enrichment.ts     # Batch enrichment orchestration (translate-only fast path)
│   ├── venue-review.ts         # Venue review approve/reject/merge (agent-callable)
│   └── venue-settlement.ts     # Venue matching/creation
└── api/
    └── duplicate-detection.ts  # External-ID dedupe shared by all sources

src/jobs-worker/                # baeventos-jobs Worker (wrangler.jobs.jsonc)
├── index.ts                    # Workflows: daily scrape, catch-up, guest retention, source check
├── sources.ts                  # One import per source; no-write catalog read
├── daily-scrape.ts             # scrape_runs open/close, blocklist cleanup
├── enrichment.ts               # Daily and catch-up enrichment batches
└── browser.ts                  # Browser Rendering session owner

src/shared/lib/
├── ai/
│   ├── enrichment.ts           # Jina + LLM description extraction, translation
│   └── embeddings.ts           # OpenAI embedding generation
└── browser/release.ts          # Coalesced, confirmed browser release
```

## Browser Automation Architecture

Meetup and BA Tourism render their listings in Cloudflare Browser Rendering through the jobs
Worker's `BROWSER` binding and `@cloudflare/playwright`. See
[browser acquisition](browser-acquisition.md).

| File | Source | Purpose |
|------|--------|---------|
| `scrapers/meetup/browser-scraper.ts` | Meetup | Scrape events by date range |
| `scrapers/ba-tourism/browser-scraper.ts` | BA Tourism | Scrape tourism portal events |

## Valid Categories & Vibes

**Categories:** techno, house, electronic, jazz, rock, indie, latin, tango, classical, hip-hop, reggaeton, folk, art, theatre, comedy, film, food, market, festival, workshop, networking, sports, other

**Vibes:** underground, mainstream, chill, high-energy, romantic, family-friendly, lgbtq-friendly, expat-friendly, local, touristy, intimate, massive, outdoor, rooftop

## Key Files

See the "Key Files" section under "Automated Enrichment Job" above — the admin import
wizard, SourceAdapters, and admin enrichment hooks were removed (2026-08-10, see
`docs/decisions.md`).

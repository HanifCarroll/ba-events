# Event Import Sources & Enrichment Process

This document outlines the two-phase event import architecture: fast initial import followed by enrichment to fill in missing data.

## Import Sources Overview

| Source | Missing from Initial Import | Auto-Enrich Default |
|--------|----------------------------|---------------------|
| Passline | Descriptions | Yes |
| Eventbrite | Price, categories/vibes | No |
| BA Tourism | Very little (most complete) | No |
| Meetup | Descriptions, venue details | Yes |

## Source Details

### Passline

**Initial import captures:**
- Event name, venue name
- Dates and times (start/end)
- Price (min price)
- Event URL, images
- Artists, sold-out status
- Categories/vibes (inferred from Passline's event metadata)

**Missing (requires enrichment):**
- Descriptions - must be scraped from individual event pages via Jina + Claude Haiku

### Eventbrite

**Initial import captures:**
- Event name, description (from JSON-LD)
- Venue name, full address, coordinates
- Dates (start/end)
- Image URL, event URL

**Missing (requires enrichment):**
- Price - must be scraped from individual event pages
- Categories/vibes - inferred by AI from name + description

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

The following table documents the client-side vs server-side enrichment strategy for each source, along with the technical reasons for each decision.

| Source | Strategy | Reason | Description Method | Venue Method | Known Language |
|--------|----------|--------|-------------------|--------------|----------------|
| **Passline** | Client-side | Cloudflare blocks server-side requests | JSON-LD `description` field | JSON-LD `location.name` + DOM address patterns | Spanish (es) |
| **Meetup** | Server direct fetch | Jina Reader returns HTTP 451 | `__NEXT_DATA__` props | JSON-LD `@type: Place` | Variable (detect) |
| **Luma** | Server-side (Jina) | Works normally | `__NEXT_DATA__` or JSON-LD | `geo_address_json` or venue object | Variable (detect) |
| **BA Tourism** | Server-side (Jina + AI) | Works normally | Jina markdown → Haiku extraction | Regex after "¿Dónde?" heading | Spanish (es) |
| **Eventbrite** | Server-side (Jina + AI) | Works normally | Jina markdown → Haiku extraction | JSON-LD Event.location | Variable (detect) |

### Decision Factors

1. **Cloudflare/Bot Protection** → Use client-side extraction (browser context)
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

### Phase 1: Fast Import

1. User selects source in import wizard
2. Browser fetches raw events from source API
3. Server processes events:
   - Venue matching (exact + fuzzy match against existing venues)
   - Data transformation to standardized format
   - Embedding generation from Spanish descriptions
4. Preview shown for user review before import

### Phase 2: Enrichment (On-Demand)

#### Description Enrichment (Passline, Meetup)

Used for events missing descriptions (primarily Passline and Meetup):
1. Fetch webpage as markdown via Jina Reader
2. Use Claude Haiku to extract semantic Spanish description
3. Use Claude Haiku to translate to English
4. Re-generate embeddings with new descriptions

Events are eligible for enrichment if they have `!description_es && !!link`.

#### Eventbrite Enrichment

1. Fetch individual event pages to extract price
2. Use Claude Haiku to infer categories/vibes from name + description

#### Meetup Venue Enrichment

1. Use Playwright browser automation to visit event detail pages
2. Extract venue info via JSON-LD or DOM parsing
3. Batch processing with controlled concurrency (3 parallel pages)
4. Rate-limiting delays between batches

## Valid Categories & Vibes

**Categories:** techno, house, electronic, jazz, rock, indie, latin, tango, classical, hip-hop, reggaeton, folk, art, theatre, comedy, film, food, market, festival, workshop, networking, sports, other

**Vibes:** underground, mainstream, chill, high-energy, romantic, family-friendly, lgbtq-friendly, expat-friendly, local, touristy, intimate, massive, outdoor, rooftop

## Key Files

```
src/features/import/
├── adapters/
│   ├── index.ts                # Source adapter registry
│   ├── types.ts                # SourceAdapter interface
│   ├── enrichment-types.ts     # EnrichmentAdapter interface
│   ├── enrichment/
│   │   ├── index.ts            # Enrichment adapter registry
│   │   ├── passline-enrichment.ts    # Client-side (Cloudflare)
│   │   ├── meetup-enrichment.ts      # Server direct fetch (Jina 451)
│   │   ├── luma-enrichment.ts        # Server-side Jina
│   │   ├── ba-tourism-enrichment.ts  # Server-side Jina + AI
│   │   └── eventbrite-enrichment.ts  # Server-side Jina + AI
│   ├── passline-adapter.ts     # Passline source adapter
│   ├── meetup-adapter.ts       # Meetup source adapter
│   ├── luma-adapter.ts         # Luma source adapter
│   ├── ba-tourism-adapter.ts   # BA Tourism source adapter
│   └── eventbrite-adapter.ts   # Eventbrite source adapter
├── scrapers/
│   ├── venue-matcher.ts        # Venue matching logic
│   ├── passline/               # Passline scraper + client enrichment
│   ├── eventbrite/             # Eventbrite scraper + enrichment
│   ├── meetup/                 # Meetup scraper + enrichment
│   ├── luma/                   # Luma scraper + enrichment
│   └── ba-tourism/             # BA Tourism scraper
├── core/
│   └── event-enrichment.ts     # Batch enrichment orchestration
└── hooks/
    └── useImportWizard.ts      # Import wizard state machine

src/shared/lib/ai/
├── enrichment.ts               # Jina + Haiku description extraction
└── embeddings.ts               # OpenAI embedding generation
```

# Event Import Sources & Enrichment Process

This document outlines the two-phase event import architecture: fast initial import followed by enrichment to fill in missing data.

## Import Sources Overview

| Source | Missing from Initial Import | Auto-Enrich Default |
|--------|----------------------------|---------------------|
| Passline | Descriptions, categories/vibes | Yes |
| Eventbrite | Price, categories/vibes | No |
| BA Tourism | Very little (most complete) | No |
| Meetup | Venue details, categories/vibes | Yes |

## Source Details

### Passline

**Initial import captures:**
- Event name, venue name
- Dates and times (start/end)
- Price (min price)
- Event URL, images
- Artists, sold-out status

**Missing (requires enrichment):**
- Descriptions - must be scraped from individual event pages
- Categories/vibes - inferred by AI from name + scraped description

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
- Event name, description
- Dates/times, timezone
- Group name (organizer)
- Price, attendee count
- Event URL, image
- Category (Meetup's native categories)
- Recurring event patterns (expanded to multiple dates)

**Missing (requires enrichment):**
- Venue details - often null in list data, requires visiting individual event pages
- Categories/vibes - needs remapping from Meetup's category system

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

#### Description Enrichment (All Sources)

Used primarily for Passline events:
1. Fetch webpage as markdown via Jina
2. Use Claude Haiku to extract semantic Spanish description
3. Translate to English
4. Re-generate embeddings with new descriptions

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
src/lib/
├── admin.ts                    # Server functions for import/enrichment
├── enrichment.ts               # Description enrichment (Jina + Claude)
├── source-metadata.ts          # Data gap definitions per source
├── scrapers/
│   ├── venue-matcher.ts        # Venue matching logic
│   ├── passline/               # Passline scraper + transformer
│   ├── eventbrite/             # Eventbrite scraper + enrichment
│   ├── meetup/                 # Meetup scraper + venue enrichment
│   └── ba-tourism/             # BA Tourism scraper
```
